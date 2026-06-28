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

    def register_callback(self, callback: Callable):
        self._callbacks.append(callback)

    def connect(self):
        try:
            self._api.connect()
            self._connected = True
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
            except Exception as e:
                logger.debug(f"Poll error for {self.printer.name}: {e}")
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
                self.printer.ams_units = []
                return
            ams_units = []
            for ams_id, ams in hub.ams_hub.items():
                for tray_idx, tray in ams.filament_trays.items():
                    color = tray.tray_color
                    if color and not color.startswith("#"):
                        color = "#" + color
                    elif not color:
                        color = "#CCCCCC"
                    material = tray.tray_type or "Unknown"
                    material_clean = material.split("_")[-1] if "_" in material else material
                    ams_units.append(AMSStatus(
                        tray_id=int(f"{ams_id}{tray_idx}"),
                        color=color,
                        material=material_clean,
                        temperature=ams.temperature,
                        remaining=100,
                    ))
            self.printer.ams_units = ams_units
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

    def set_print_speed(self, level: int):
        try:
            self._api.set_print_speed(int(level))
        except Exception as e:
            logger.error(f"Set print speed failed for {self.printer.name}: {e}")

    def get_ams_data(self) -> list[dict]:
        try:
            hub = self._api.ams_hub()
            if hub is None or not hub.ams_hub:
                return []
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
            return result
        except Exception as e:
            logger.debug(f"AMS data error: {e}")
            return []

    def start_print_file(self, filename: str, plate_number: int = 1,
                         use_ams: bool = True,
                         ams_mapping: list[int] = None,
                         flow_calibration: bool = True) -> bool:
        try:
            result = self._api.start_print(
                filename,
                plate_number,
                use_ams=use_ams,
                ams_mapping=ams_mapping or [0],
                flow_calibration=flow_calibration,
            )
            logger.info(
                f"Start print {filename} on {self.printer.name} "
                f"plate={plate_number} use_ams={use_ams} "
                f"mapping={ams_mapping or [0]} result={result}"
            )
            return bool(result)
        except Exception as e:
            logger.error(f"Start print failed for {self.printer.name}: {e}")
            return False

    def get_camera_url(self) -> str:
        return f"rtsp://{self.printer.ip_address}:322/streaming/live/1"

    def upload_file(self, local_path: str, remote_name: str = None,
                    progress_callback: Callable = None) -> bool:
        try:
            from pathlib import Path
            remote_name = remote_name or Path(local_path).name
            ftp = self._api.ftp_client
            if hasattr(ftp, 'ftps') and hasattr(ftp.ftps, 'timeout'):
                ftp.ftps.timeout = 120
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

    @property
    def is_connected(self) -> bool:
        return self._connected