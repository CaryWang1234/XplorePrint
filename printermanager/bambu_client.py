"""
XplorePrint - Bambu Lab Client (bambulabs_api wrapper)
FRC Team 11019 Xplore

Wraps the bambulabs_api library for communication with Bambu Lab 3D printers.
- github.com/Bambu-Research-Group/bambulabs_api
- Uses MQTT (port 8883) for real-time status and control
- Uses FTPS (port 990) for file transfer
- Uses RTSP (port 322) for camera streaming
"""

import logging
import re
import subprocess
import threading
import time
from typing import Optional, Callable

import bambulabs_api as bl

from .models import Printer, PrinterStatus, PrinterModel, AMSStatus

logger = logging.getLogger(__name__)


class BambuClient:
    """
    Bambu Lab printer client using the official bambulabs_api library.

    Manages the connection lifecycle and maps the library's state
    to our internal Printer data model.
    """

    POLL_INTERVAL = 2.0
    MAX_CONSECUTIVE_ERRORS = 10

    def __init__(self, printer: Printer):
        self.printer = printer
        self._api = bl.Printer(
            ip_address=printer.ip_address,
            access_code=printer.access_code,
            serial=printer.serial_number,
        )
        self._connected = False
        self._callbacks: list[Callable] = []
        self._poll_thread: Optional[threading.Thread] = None
        self._stop_poll = threading.Event()
        self._cached_ams_data: list[dict] = []
        self._consecutive_errors = 0

    def register_callback(self, callback: Callable):
        self._callbacks.append(callback)

    def connect(self):
        try:
            self._api.connect()
            self._connected = True
            self._consecutive_errors = 0
            self.printer.status = PrinterStatus.ONLINE

            self._wait_for_printer_ready()

            self._stop_poll.clear()
            self._poll_thread = threading.Thread(
                target=self._poll_loop,
                daemon=True,
            )
            self._poll_thread.start()

            self._start_camera()

            logger.info(
                f"Connected to {self.printer.name} "
                f"at {self.printer.ip_address} via bambulabs_api"
            )
        except Exception as e:
            logger.error(f"Connection failed for {self.printer.name}: {e}")
            self.printer.status = PrinterStatus.OFFLINE
            self._connected = False

    def _start_camera(self):
        try:
            self._api.camera_start()
            logger.info(f"Camera started for {self.printer.name}")
        except Exception as e:
            logger.warning(f"Camera start failed for {self.printer.name}: {e}")

    def _stop_camera(self):
        try:
            self._api.camera_stop()
            logger.info(f"Camera stopped for {self.printer.name}")
        except Exception as e:
            logger.warning(f"Camera stop failed for {self.printer.name}: {e}")

    def get_camera_frame(self) -> bytes | None:
        try:
            if self._api.camera_client and self._api.camera_client.last_frame:
                return bytes(self._api.camera_client.last_frame)
        except Exception:
            pass
        return None

    def _wait_for_printer_ready(self, timeout: float = 15.0):
        waited = 0.0
        while not self._api.mqtt_client_ready():
            if waited >= timeout:
                logger.warning(
                    f"Timeout waiting for {self.printer.name} to report status"
                )
                return
            time.sleep(0.5)
            waited += 0.5
        logger.info(f"{self.printer.name} reported initial status (waited {waited:.1f}s)")

    def disconnect(self):
        self._stop_poll.set()
        self._connected = False
        self._stop_camera()
        try:
            self._api.disconnect()
        except Exception as e:
            logger.warning(f"Error disconnecting {self.printer.name}: {e}")
        self.printer.status = PrinterStatus.OFFLINE

    def _poll_loop(self):
        while not self._stop_poll.is_set():
            try:
                self._update_state()
                self._consecutive_errors = 0
            except Exception as e:
                self._consecutive_errors += 1
                self.printer.status = PrinterStatus.ERROR
                if self._consecutive_errors == 1:
                    logger.warning(f"Poll error for {self.printer.name}: {e}")
                elif self._consecutive_errors >= self.MAX_CONSECUTIVE_ERRORS:
                    logger.error(
                        f"{self.printer.name}: {self._consecutive_errors} consecutive poll errors, "
                        f"marking as offline"
                    )
                    self._connected = False
                    self.printer.status = PrinterStatus.OFFLINE
            self._stop_poll.wait(self.POLL_INTERVAL)

    def _update_state(self):
        if not self._connected:
            return
        if not self._api.mqtt_client_ready():
            return

        try:
            gcode_state = self._api.get_state()

            state_map = {
                bl.GcodeState.IDLE: PrinterStatus.IDLE,
                bl.GcodeState.PREPARE: PrinterStatus.PRINTING,
                bl.GcodeState.RUNNING: PrinterStatus.PRINTING,
                bl.GcodeState.PAUSE: PrinterStatus.PAUSED,
                bl.GcodeState.FINISH: PrinterStatus.FINISHING,
                bl.GcodeState.FAILED: PrinterStatus.ERROR,
            }
            self.printer.status = state_map.get(gcode_state, PrinterStatus.IDLE)

            if gcode_state == bl.GcodeState.FAILED:
                self.printer.error_message = str(self._api.print_error_code)
                self.printer.hms_code = self._safe_int(self._api.print_error_code)
            else:
                self.printer.hms_code = 0

            self.printer.nozzle_temp = self._safe_float(self._api.get_nozzle_temperature())
            self.printer.target_nozzle_temp = self._safe_float(
                self._api.mqtt_client.get_nozzle_temperature_target()
            )
            self.printer.bed_temp = self._safe_float(self._api.get_bed_temperature())
            self.printer.target_bed_temp = self._safe_float(
                self._api.mqtt_client.get_bed_temperature_target()
            )
            self.printer.chamber_temp = self._safe_float(self._api.get_chamber_temperature())
            self.printer.print_progress = self._safe_float(self._api.get_percentage())
            self.printer.print_time_remaining = self._safe_time(self._api.get_time())
            self.printer.current_file = self._safe_str(self._api.get_file_name())
            self.printer.layer_num = self._safe_int(self._api.current_layer_num())
            self.printer.total_layers = self._safe_int(self._api.total_layer_num())
            self.printer.wifi_signal = self._safe_int(self._api.wifi_signal)

            self._update_ams()

            self.printer.last_updated = time.time()

            for cb in self._callbacks:
                cb(self.printer)

        except Exception as e:
            logger.debug(f"State update error for {self.printer.name}: {e}")

    def _update_ams(self):
        try:
            hub = self._api.ams_hub()
            if hub is None or not hub.ams_hub:
                return
            ams_units = []
            raw_data = []

            raw_dump = {}
            try:
                raw_dump = self._api.mqtt_client.dump()
            except Exception:
                pass
            raw_ams = raw_dump.get("print", {}).get("ams", {}).get("ams", [])

            for ams_id, ams in hub.ams_hub.items():
                trays = []
                raw_ams_unit = raw_ams[ams_id] if ams_id < len(raw_ams) else {}
                raw_trays = raw_ams_unit.get("tray", [])
                for tray_idx, tray in ams.filament_trays.items():
                    color = tray.tray_color
                    if color and not color.startswith("#"):
                        color = "#" + color
                    elif not color:
                        color = "#CCCCCC"
                    material = tray.tray_type or "Unknown"
                    material_clean = material.split("_")[-1] if "_" in material else material

                    raw_tray = raw_trays[tray_idx] if tray_idx < len(raw_trays) else {}
                    remaining = 100
                    try:
                        remain_val = raw_tray.get("remain", None)
                        if remain_val is not None:
                            remaining = int(remain_val)
                    except (ValueError, TypeError):
                        pass

                    ams_units.append(AMSStatus(
                        tray_id=int(f"{ams_id}{tray_idx}"),
                        color=color,
                        material=material_clean,
                        temperature=ams.temperature,
                        humidity=ams.humidity,
                        remaining=remaining,
                    ))
                    trays.append({
                        "tray_id": tray_idx,
                        "color": color,
                        "material": tray.tray_type or "Unknown",
                        "nozzle_temp_min": tray.nozzle_temp_min,
                        "nozzle_temp_max": tray.nozzle_temp_max,
                        "tray_id_name": tray.tray_id_name,
                        "remaining": remaining,
                    })
                raw_data.append({
                    "ams_id": ams_id,
                    "humidity": ams.humidity,
                    "temperature": ams.temperature,
                    "trays": trays,
                })
            self.printer.ams_units = ams_units
            self._cached_ams_data = raw_data
        except Exception:
            pass

    @staticmethod
    def _safe_float(val) -> float:
        try:
            return round(float(val), 1)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _safe_int(val) -> int:
        try:
            return int(val)
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _safe_str(val) -> str:
        try:
            return str(val) if val else ""
        except (TypeError, ValueError):
            return ""

    @staticmethod
    def _safe_time(val) -> int:
        if val is None:
            return 0
        if isinstance(val, str) and val.lower() == "unknown":
            return 0
        try:
            return int(val) * 60
        except (TypeError, ValueError):
            return 0

    def pause_print(self):
        try:
            self._api.pause_print()
        except Exception as e:
            logger.error(f"Pause failed for {self.printer.name}: {e}")

    def resume_print(self):
        try:
            self._api.resume_print()
        except Exception as e:
            logger.error(f"Resume failed for {self.printer.name}: {e}")

    def stop_print(self):
        try:
            self._api.stop_print()
        except Exception as e:
            logger.error(f"Stop failed for {self.printer.name}: {e}")

    def load_filament(self, ams_id: int = None, tray_id: int = None):
        try:
            if ams_id is not None and tray_id is not None:
                payload = {
                    "print": {
                        "command": "ams_change_filament",
                        "target": 255,
                        "curr_temp": 215,
                        "tar_temp": 215,
                        "ams_id": ams_id,
                        "tray_id": tray_id,
                    }
                }
                self._api.mqtt_client._PrinterMQTTClient__publish_command(payload)
            else:
                self._api.load_filament_spool()
        except Exception as e:
            logger.error(f"Load filament failed for {self.printer.name}: {e}")

    def unload_filament(self):
        try:
            self._api.unload_filament_spool()
        except Exception as e:
            logger.error(f"Unload filament failed for {self.printer.name}: {e}")

    def set_led(self, mode: str = "on"):
        try:
            if mode == "on":
                self._api.turn_light_on()
            else:
                self._api.turn_light_off()
        except Exception as e:
            logger.error(f"LED control failed for {self.printer.name}: {e}")

    def set_nozzle_temp(self, temp: float):
        try:
            self._api.set_nozzle_temperature(int(temp))
        except Exception as e:
            logger.error(f"Set nozzle temp failed for {self.printer.name}: {e}")

    def set_bed_temp(self, temp: float):
        try:
            self._api.set_bed_temperature(int(temp))
        except Exception as e:
            logger.error(f"Set bed temp failed for {self.printer.name}: {e}")

    def send_gcode(self, gcode: str):
        try:
            self._api.mqtt_client.send_gcode(gcode)
        except Exception as e:
            logger.error(f"G-code send failed for {self.printer.name}: {e}")

    def home_axes(self):
        try:
            self._api.home_printer()
        except Exception as e:
            logger.error(f"Home failed for {self.printer.name}: {e}")

    def move_axis(self, axis: str, distance: float, speed: int = 3000):
        if axis.upper() == "Z":
            try:
                self._api.move_z_axis(distance)
            except Exception as e:
                logger.error(f"Move Z failed for {self.printer.name}: {e}")
        else:
            self.send_gcode(f"G91\nG1 {axis}{distance} F{speed}\nG90")

    def set_fan_speed(self, speed: int):
        try:
            self._api.set_part_fan_speed(int(speed))
        except Exception as e:
            logger.error(f"Set fan speed failed for {self.printer.name}: {e}")

    def set_aux_fan_speed(self, speed: int):
        try:
            self._api.set_aux_fan_speed(int(speed))
        except Exception as e:
            logger.error(f"Set aux fan speed failed for {self.printer.name}: {e}")

    def set_chamber_fan_speed(self, speed: int):
        try:
            self._api.set_chamber_fan_speed(int(speed))
        except Exception as e:
            logger.error(f"Set chamber fan speed failed for {self.printer.name}: {e}")

    def set_print_speed(self, level: int):
        try:
            self._api.set_print_speed(int(level))
        except Exception as e:
            logger.error(f"Set print speed failed for {self.printer.name}: {e}")

    def get_ams_data(self) -> list[dict]:
        try:
            hub = self._api.ams_hub()
            if hub is None or not hub.ams_hub:
                return self._cached_ams_data
            result = []
            for ams_id, ams in hub.ams_hub.items():
                trays = []
                for tray_idx, tray in ams.filament_trays.items():
                    color = tray.tray_color or ""
                    if color and not color.startswith("#"):
                        color = "#" + color
                    trays.append({
                        "tray_id": tray_idx,
                        "color": color,
                        "material": tray.tray_type or "Unknown",
                        "nozzle_temp_min": tray.nozzle_temp_min,
                        "nozzle_temp_max": tray.nozzle_temp_max,
                        "tray_id_name": tray.tray_id_name,
                    })
                result.append({
                    "ams_id": ams_id,
                    "humidity": ams.humidity,
                    "temperature": ams.temperature,
                    "trays": trays,
                })
            self._cached_ams_data = result
            return result
        except Exception as e:
            logger.debug(f"AMS data error: {e}")
            return self._cached_ams_data

    def load_cached_ams(self, data: list[dict]):
        self._cached_ams_data = data or []
        if data:
            ams_units = []
            for ams in data:
                for tray in ams.get("trays", []):
                    color = tray.get("color", "#CCCCCC")
                    material = tray.get("material", "Unknown")
                    material_clean = material.split("_")[-1] if "_" in material else material
                    ams_units.append(AMSStatus(
                        tray_id=int(f"{ams['ams_id']}{tray['tray_id']}"),
                        color=color,
                        material=material_clean,
                        temperature=ams.get("temperature", 0),
                        remaining=100,
                    ))
            self.printer.ams_units = ams_units

    def start_print_file(self, filename: str, plate_number: int = 1,
                         use_ams: bool = True,
                         ams_mapping: list[int] = None,
                         flow_calibration: bool = True) -> bool:
        try:
            if ams_mapping is None or len(ams_mapping) == 0:
                ams_mapping = [0]

            is_gcode_only = filename.lower().endswith(".gcode") and not filename.lower().endswith(".3mf")

            logger.info(
                f"start_print_file: {filename} plate={plate_number} "
                f"use_ams={use_ams} mapping={ams_mapping} "
                f"flow_cali={flow_calibration} gcode_only={is_gcode_only}"
            )

            if not self._api.mqtt_client_ready():
                logger.error(f"MQTT client not ready for {self.printer.name}")
                return False

            if is_gcode_only:
                result = self._start_print_gcode(
                    filename, use_ams=use_ams,
                    ams_mapping=ams_mapping,
                    flow_calibration=flow_calibration,
                )
            else:
                result = self._start_print_3mf(
                    filename, plate_number=plate_number,
                    use_ams=use_ams, ams_mapping=ams_mapping,
                    flow_calibration=flow_calibration,
                )

            logger.info(
                f"Start print result: {result} "
                f"file={filename} plate={plate_number}"
            )
            return bool(result)
        except Exception as e:
            logger.error(f"Start print failed for {self.printer.name}: {e}", exc_info=True)
            return False

    def _start_print_gcode(self, filename: str, use_ams: bool = True,
                           ams_mapping: list[int] = None,
                           flow_calibration: bool = True) -> bool:
        if ams_mapping is None:
            ams_mapping = [0]
        payload = {
            "print": {
                "sequence_id": "20000",
                "command": "project_file",
                "param": filename,
                "url": f"ftp:///{filename}",
                "file": filename,
                "subtask_name": filename,
                "profile_id": "",
                "project_id": "",
                "use_ams": use_ams,
                "ams_mapping": list(ams_mapping),
                "bed_leveling": True,
                "flow_cali": flow_calibration,
                "vibration_cali": True,
                "bed_type": "textured_plate",
                "layer_inspect": False,
                "task_id": "",
                "use_ext_spool": bool(not use_ams),
                "calibration": False,
                "timelapse": False,
                "xcam_mqtt_protocol": "1",
                "xcam_mqtt_protocol_ver": "1",
                "version": 1,
            }
        }
        logger.info(
            f"Sending gcode print command: {payload} "
            f"to {self.printer.name}"
        )
        return self._api.mqtt_client._PrinterMQTTClient__publish_command(payload)

    def _start_print_3mf(self, filename: str, plate_number: int = 1,
                         use_ams: bool = True,
                         ams_mapping: list[int] = None,
                         flow_calibration: bool = True) -> bool:
        return self._api.start_print(
            filename,
            plate_number,
            use_ams=use_ams,
            ams_mapping=ams_mapping,
            flow_calibration=flow_calibration,
        )

    def get_camera_url(self) -> str:
        return f"rtsp://{self.printer.ip_address}:322/streaming/live/1"

    def upload_file(self, local_path: str, remote_name: str = None,
                    progress_callback: Callable = None) -> bool:
        try:
            from pathlib import Path
            remote_name = remote_name or Path(local_path).name
            ftp = self._api.ftp_client
            if hasattr(ftp, 'ftps'):
                ftp.ftps.timeout = 300
            with open(local_path, "rb") as f:
                self._api.upload_file(f, remote_name)
            if progress_callback:
                progress_callback(100)
            logger.info(f"Uploaded {remote_name} to {self.printer.name}")
            return True
        except Exception as e:
            logger.error(f"Upload failed for {self.printer.name}: {e}")
            return False

    def list_files(self) -> list[str]:
        try:
            ftp = self._api.ftp_client
            if ftp:
                result = ftp.list_directory()
                if isinstance(result, tuple) and len(result) == 2:
                    _, lines = result
                else:
                    lines = result if isinstance(result, list) else []
                filenames = []
                for line in lines:
                    if isinstance(line, str):
                        parts = line.split()
                        if parts:
                            name = parts[-1]
                            if name.endswith((".3mf", ".gcode", ".gcode.3mf")):
                                filenames.append(name)
                return filenames
            return []
        except Exception as e:
            logger.error(f"List files failed for {self.printer.name}: {e}")
            return []

    def delete_file(self, filename: str) -> bool:
        try:
            self._api.delete_file(filename)
            logger.info(f"Deleted {filename} from {self.printer.name}")
            return True
        except Exception as e:
            logger.error(f"Delete failed for {self.printer.name}: {e}")
            return False

    def test_latency(self) -> dict:
        try:
            ip = self.printer.ip_address
            if not ip:
                return {"success": False, "message": "打印机无 IP 地址"}

            cmd = ["ping", "-n", "1", "-w", "2000", ip]
            t0 = time.time()
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
            t1 = time.time()
            latency_ms = round((t1 - t0) * 1000, 1)

            if result.returncode != 0:
                return {"success": False, "message": f"Ping 超时 (>{latency_ms}ms)"}

            match = re.search(r"time[=<]\s*(\d+)\s*ms", result.stdout, re.IGNORECASE)
            if match:
                latency_ms = int(match.group(1))

            return {
                "success": True,
                "printer_response_ms": latency_ms,
                "message": f"Ping 延迟: {latency_ms}ms",
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "message": "Ping 超时 (3s)"}
        except Exception as e:
            return {"success": False, "message": f"延迟测试失败: {e}"}

    def get_hms_error(self) -> dict:
        """Get HMS error code and wiki lookup URL."""
        wikiname = self.printer.name
        hms_code = 0
        try:
            if self._api.mqtt_client_ready():
                hms_code = self._safe_int(self._api.print_error_code)
        except Exception:
            hms_code = self.printer.hms_code or 0

        wiki_url = ""
        if hms_code and hms_code != 0:
            wiki_url = f"https://wiki.bambulab.com/zh/hms/{hms_code}"

        return {
            "printer_name": self.printer.name,
            "hms_code": hms_code,
            "wiki_url": wiki_url,
            "wiki_home": "https://wiki.bambulab.com/zh/hms/home",
            "has_error": hms_code != 0,
        }

    @property
    def is_connected(self) -> bool:
        return self._connected