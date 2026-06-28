"""
XplorePrint - Printer Manager
FRC Team 11019 Xplore

Manages multiple Bambu Lab 3D printers, handling connections,
status updates, print job tracking, queue, history, and filament inventory.
"""

import json
import os
import csv
import io
import logging
import threading
import uuid
from collections import deque
from datetime import datetime
from typing import Optional

from .models import (
    Printer, PrinterStatus, PrinterModel, PrintJob,
    QueueItem, QueueStatus, PrintHistory, FilamentStock, TemperatureRecord,
    Robot, RobotSubsystem, PartTemplate, PartStatus, Competition
)
from .bambu_client import BambuClient

logger = logging.getLogger(__name__)

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
MAX_TEMP_HISTORY = 200


class PrinterManager:
    """Central manager for all 3D printers."""

    def __init__(self):
        self._printers: dict[str, Printer] = {}
        self._clients: dict[str, BambuClient] = {}
        self._jobs: list[PrintJob] = []
        self._queue: list[QueueItem] = []
        self._history: list[PrintHistory] = []
        self._filaments: list[FilamentStock] = []
        self._temp_history: dict[str, deque[TemperatureRecord]] = {}
        self._robots: list[Robot] = []
        self._competitions: list[Competition] = []
        self._lock = threading.Lock()
        self._callbacks: list = []
        self._prev_status: dict[str, PrinterStatus] = {}

        os.makedirs(DATA_DIR, exist_ok=True)
        self._load_config()
        self._load_history()
        self._load_queue()
        self._load_filaments()
        self._load_robots()
        self._load_competitions()
        self._init_frc_parts_library()

    @staticmethod
    def _parse_model(model_str: str) -> PrinterModel:
        try:
            return PrinterModel(model_str)
        except ValueError:
            return PrinterModel.UNKNOWN

    def _load_config(self):
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    config = json.load(f)
                for pdata in config.get("printers", []):
                    printer = Printer(
                        id=pdata["id"],
                        name=pdata["name"],
                        model=self._parse_model(pdata.get("model", "Unknown")),
                        ip_address=pdata.get("ip_address", ""),
                        access_code=pdata.get("access_code", ""),
                        serial_number=pdata.get("serial_number", ""),
                    )
                    self._printers[printer.id] = printer
                    self._temp_history[printer.id] = deque(maxlen=MAX_TEMP_HISTORY)
                    self._prev_status[printer.id] = PrinterStatus.OFFLINE
                logger.info(f"Loaded {len(self._printers)} printers from config")
            except Exception as e:
                logger.error(f"Failed to load config: {e}")

    def _save_config(self):
        config = {
            "printers": [
                {
                    "id": p.id,
                    "name": p.name,
                    "model": p.model.value,
                    "ip_address": p.ip_address,
                    "access_code": p.access_code,
                    "serial_number": p.serial_number,
                }
                for p in self._printers.values()
            ]
        }
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)

    def _load_history(self):
        path = os.path.join(DATA_DIR, "history.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    self._history.append(PrintHistory(
                        id=item["id"],
                        printer_name=item["printer_name"],
                        printer_model=item["printer_model"],
                        file_name=item["file_name"],
                        material=item.get("material", "Unknown"),
                        started_at=datetime.fromisoformat(item["started_at"]),
                        completed_at=datetime.fromisoformat(item["completed_at"]),
                        duration=item.get("duration", 0),
                        success=item.get("success", True),
                        layer_count=item.get("layer_count", 0),
                        material_used_grams=item.get("material_used_grams", 0),
                        failure_reason=item.get("failure_reason", ""),
                    ))
            except Exception as e:
                logger.error(f"Failed to load history: {e}")

    def _save_history(self):
        path = os.path.join(DATA_DIR, "history.json")
        data = []
        for h in self._history:
            data.append({
                "id": h.id,
                "printer_name": h.printer_name,
                "printer_model": h.printer_model,
                "file_name": h.file_name,
                "material": h.material,
                "started_at": h.started_at.isoformat(),
                "completed_at": h.completed_at.isoformat(),
                "duration": h.duration,
                "success": h.success,
                "layer_count": h.layer_count,
                "material_used_grams": h.material_used_grams,
                "failure_reason": h.failure_reason,
            })
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _load_queue(self):
        path = os.path.join(DATA_DIR, "queue.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    self._queue.append(QueueItem(
                        id=item["id"],
                        printer_id=item["printer_id"],
                        file_name=item["file_name"],
                        material=item.get("material", "PLA"),
                        color=item.get("color", "#3B82F6"),
                        estimated_time=item.get("estimated_time", 0),
                        priority=item.get("priority", 0),
                        status=QueueStatus(item.get("status", "waiting")),
                        created_at=datetime.fromisoformat(item["created_at"]),
                        notes=item.get("notes", ""),
                        robot_id=item.get("robot_id", ""),
                        subsystem=item.get("subsystem", ""),
                        assigned_to=item.get("assigned_to", ""),
                        part_status=item.get("part_status", "needed"),
                    ))
            except Exception as e:
                logger.error(f"Failed to load queue: {e}")

    def _save_queue(self):
        path = os.path.join(DATA_DIR, "queue.json")
        data = []
        for q in self._queue:
            data.append({
                "id": q.id,
                "printer_id": q.printer_id,
                "file_name": q.file_name,
                "material": q.material,
                "color": q.color,
                "estimated_time": q.estimated_time,
                "priority": q.priority,
                "status": q.status.value,
                "created_at": q.created_at.isoformat(),
                "notes": q.notes,
                "robot_id": getattr(q, 'robot_id', ''),
                "subsystem": getattr(q, 'subsystem', ''),
                "assigned_to": getattr(q, 'assigned_to', ''),
                "part_status": getattr(q, 'part_status', 'needed'),
            })
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _load_filaments(self):
        path = os.path.join(DATA_DIR, "filaments.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    self._filaments.append(FilamentStock(
                        id=item["id"],
                        material=item.get("material", "PLA"),
                        brand=item.get("brand", ""),
                        color=item.get("color", "#3B82F6"),
                        color_name=item.get("color_name", ""),
                        total_weight=item.get("total_weight", 1000),
                        remaining_weight=item.get("remaining_weight", 1000),
                        price=item.get("price", 0),
                        spool_weight=item.get("spool_weight", 0),
                        purchase_date=item.get("purchase_date", ""),
                        notes=item.get("notes", ""),
                    ))
            except Exception as e:
                logger.error(f"Failed to load filaments: {e}")

    def _save_filaments(self):
        path = os.path.join(DATA_DIR, "filaments.json")
        data = []
        for f in self._filaments:
            data.append({
                "id": f.id,
                "material": f.material,
                "brand": f.brand,
                "color": f.color,
                "color_name": f.color_name,
                "total_weight": f.total_weight,
                "remaining_weight": f.remaining_weight,
                "price": f.price,
                "spool_weight": f.spool_weight,
                "purchase_date": f.purchase_date,
                "notes": f.notes,
            })
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def register_callback(self, callback):
        self._callbacks.append(callback)

    def _notify(self):
        data = self.get_all_printer_data()
        for cb in self._callbacks:
            cb(data)

    def add_printer(
        self,
        name: str,
        ip_address: str,
        access_code: str,
        serial_number: str,
        model: str = "Unknown"
    ) -> Printer:
        printer_id = f"printer_{len(self._printers) + 1}_{serial_number[-4:]}"
        printer = Printer(
            id=printer_id,
            name=name,
            model=self._parse_model(model),
            ip_address=ip_address,
            access_code=access_code,
            serial_number=serial_number,
        )
        self._printers[printer.id] = printer
        self._temp_history[printer.id] = deque(maxlen=MAX_TEMP_HISTORY)
        self._prev_status[printer.id] = PrinterStatus.OFFLINE
        self._save_config()
        self._notify()
        return printer

    def remove_printer(self, printer_id: str):
        self.disconnect_printer(printer_id)
        self._printers.pop(printer_id, None)
        self._temp_history.pop(printer_id, None)
        self._prev_status.pop(printer_id, None)
        self._save_config()
        self._notify()

    def connect_printer(self, printer_id: str):
        printer = self._printers.get(printer_id)
        if not printer:
            return
        if printer_id in self._clients:
            self._clients[printer_id].disconnect()
        client = BambuClient(printer)
        client.register_callback(lambda p: self._on_printer_update(p))
        client.connect()
        self._clients[printer_id] = client

    def _on_printer_update(self, printer: Printer):
        if printer.id in self._temp_history:
            self._temp_history[printer.id].append(TemperatureRecord(
                timestamp=datetime.now(),
                nozzle_temp=printer.nozzle_temp,
                bed_temp=printer.bed_temp,
                chamber_temp=printer.chamber_temp,
            ))

        prev = self._prev_status.get(printer.id)
        new_status = printer.status
        if prev != new_status:
            if new_status == PrinterStatus.FINISHING and prev == PrinterStatus.PRINTING:
                self._record_print_completion(printer, success=True)
            elif new_status == PrinterStatus.ERROR and prev == PrinterStatus.PRINTING:
                self._record_print_completion(printer, success=False)
            self._prev_status[printer.id] = new_status

        self._notify()

    def _record_print_completion(self, printer: Printer, success: bool):
        if not printer.current_file:
            return
        material = "Unknown"
        if printer.ams_units:
            material = printer.ams_units[0].material
        history = PrintHistory(
            id=str(uuid.uuid4())[:8],
            printer_name=printer.name,
            printer_model=printer.model.value,
            file_name=printer.current_file,
            material=material,
            started_at=printer.last_updated,
            completed_at=datetime.now(),
            duration=printer.print_time_elapsed,
            success=success,
            layer_count=printer.total_layers,
            material_used_grams=0,
            failure_reason=printer.error_message if not success else "",
        )
        self._history.insert(0, history)
        self._save_history()

        self._update_queue_completion(printer.id)

    def _update_queue_completion(self, printer_id: str):
        for item in self._queue:
            if item.printer_id == printer_id and item.status == QueueStatus.PRINTING:
                item.status = QueueStatus.COMPLETED
                self._save_queue()
                break

    def disconnect_printer(self, printer_id: str):
        client = self._clients.pop(printer_id, None)
        if client:
            client.disconnect()

    def connect_all(self):
        for pid in self._printers:
            self.connect_printer(pid)

    def disconnect_all(self):
        for pid in list(self._clients.keys()):
            self.disconnect_printer(pid)

    def get_printer(self, printer_id: str) -> Optional[Printer]:
        return self._printers.get(printer_id)

    def get_all_printers(self) -> list[Printer]:
        return list(self._printers.values())

    def get_all_printer_data(self) -> list[dict]:
        return [self._printer_to_dict(p) for p in self._printers.values()]

    def _printer_to_dict(self, printer: Printer) -> dict:
        return {
            "id": printer.id,
            "name": printer.name,
            "model": printer.model.value,
            "ip_address": printer.ip_address,
            "serial_number": printer.serial_number,
            "status": printer.status.value,
            "nozzle_temp": printer.nozzle_temp,
            "target_nozzle_temp": printer.target_nozzle_temp,
            "bed_temp": printer.bed_temp,
            "target_bed_temp": printer.target_bed_temp,
            "chamber_temp": printer.chamber_temp,
            "print_progress": printer.print_progress,
            "layer_num": printer.layer_num,
            "total_layers": printer.total_layers,
            "print_time_remaining": printer.print_time_remaining,
            "print_time_elapsed": printer.print_time_elapsed,
            "ams_units": [
                {
                    "tray_id": a.tray_id,
                    "color": a.color,
                    "material": a.material,
                    "temperature": a.temperature,
                    "remaining": a.remaining,
                }
                for a in printer.ams_units
            ],
            "current_file": printer.current_file,
            "error_message": printer.error_message,
            "wifi_signal": printer.wifi_signal,
        }

    def send_command(self, printer_id: str, command: str, **kwargs):
        client = self._clients.get(printer_id)
        if not client:
            return
        if command == "pause":
            client.pause_print()
        elif command == "resume":
            client.resume_print()
        elif command == "stop":
            client.stop_print()
        elif command == "led_on":
            client.set_led("on")
        elif command == "led_off":
            client.set_led("off")
        elif command == "set_nozzle_temp":
            client.set_nozzle_temp(kwargs.get("temp", 200))
        elif command == "set_bed_temp":
            client.set_bed_temp(kwargs.get("temp", 60))
        elif command == "home":
            client.home_axes()
        elif command == "set_fan":
            client.set_fan_speed(kwargs.get("speed", 128))
        elif command == "set_speed":
            client.set_print_speed(kwargs.get("level", 2))
        elif command == "move_z":
            client.move_axis("Z", kwargs.get("distance", 10))
        elif command == "send_gcode":
            client.send_gcode(kwargs.get("gcode", ""))

    def get_ams_data(self, printer_id: str) -> list[dict]:
        client = self._clients.get(printer_id)
        if not client:
            return []
        return client.get_ams_data()

    def upload_to_printer(self, printer_id: str, local_path: str,
                          remote_name: str = None,
                          progress_callback=None) -> dict:
        client = self._clients.get(printer_id)
        if not client:
            return {"success": False, "message": "打印机未连接"}
        ok = client.upload_file(local_path, remote_name, progress_callback)
        return {"success": ok, "message": "上传成功" if ok else "上传失败"}

    def list_printer_files(self, printer_id: str) -> list[str]:
        client = self._clients.get(printer_id)
        if not client:
            return []
        return client.list_files()

    def delete_printer_file(self, printer_id: str, filename: str) -> dict:
        client = self._clients.get(printer_id)
        if not client:
            return {"success": False, "message": "打印机未连接"}
        ok = client.delete_file(filename)
        return {"success": ok, "message": "删除成功" if ok else "删除失败"}

    def start_print(self, printer_id: str, filename: str) -> dict:
        client = self._clients.get(printer_id)
        if not client:
            return {"success": False, "message": "打印机未连接"}
        try:
            client.start_print_file(filename)
            return {"success": True, "message": f"开始打印: {filename}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_camera_url(self, printer_id: str) -> str:
        client = self._clients.get(printer_id)
        if not client:
            return ""
        return client.get_camera_url()

    def get_stats(self) -> dict:
        printers = self._printers.values()
        total = len(printers)
        online = sum(1 for p in printers if p.status != PrinterStatus.OFFLINE)
        printing = sum(1 for p in printers if p.status == PrinterStatus.PRINTING)
        idle = sum(1 for p in printers if p.status == PrinterStatus.IDLE)
        error = sum(1 for p in printers if p.status == PrinterStatus.ERROR)
        return {
            "total": total,
            "online": online,
            "printing": printing,
            "idle": idle,
            "error": error,
            "offline": total - online,
        }

    # ==================== 打印队列 ====================

    def add_to_queue(self, printer_id: str, file_name: str, material: str = "PLA",
                     color: str = "#3B82F6", estimated_time: int = 0,
                     priority: int = 0, notes: str = "",
                     robot_id: str = "", subsystem: str = "",
                     assigned_to: str = "", part_status: str = "needed") -> QueueItem:
        item = QueueItem(
            id=str(uuid.uuid4())[:8],
            printer_id=printer_id,
            file_name=file_name,
            material=material,
            color=color,
            estimated_time=estimated_time,
            priority=priority,
            notes=notes,
            robot_id=robot_id,
            subsystem=subsystem,
            assigned_to=assigned_to,
            part_status=part_status,
        )
        self._queue.append(item)
        self._sort_queue()
        self._save_queue()
        self._notify()
        return item

    def remove_from_queue(self, queue_id: str):
        self._queue = [q for q in self._queue if q.id != queue_id]
        self._save_queue()
        self._notify()

    def update_queue_item(self, queue_id: str, **kwargs):
        for item in self._queue:
            if item.id == queue_id:
                for key, value in kwargs.items():
                    if hasattr(item, key):
                        setattr(item, key, value)
                self._sort_queue()
                self._save_queue()
                self._notify()
                return

    def _sort_queue(self):
        self._queue.sort(key=lambda x: (-x.priority, x.created_at))

    def get_queue(self, printer_id: str = None) -> list[dict]:
        items = self._queue
        if printer_id:
            items = [q for q in items if q.printer_id == printer_id]
        return [
            {
                "id": q.id,
                "printer_id": q.printer_id,
                "printer_name": self._printers.get(q.printer_id, Printer(id="", name="Unknown")).name,
                "file_name": q.file_name,
                "material": q.material,
                "color": q.color,
                "estimated_time": q.estimated_time,
                "priority": q.priority,
                "status": q.status.value,
                "created_at": q.created_at.isoformat(),
                "notes": q.notes,
                "robot_id": getattr(q, 'robot_id', ''),
                "subsystem": getattr(q, 'subsystem', ''),
                "assigned_to": getattr(q, 'assigned_to', ''),
                "part_status": getattr(q, 'part_status', 'needed'),
            }
            for q in items
        ]

    def clear_queue(self, printer_id: str = None):
        if printer_id:
            self._queue = [q for q in self._queue if q.printer_id != printer_id]
        else:
            self._queue = []
        self._save_queue()
        self._notify()

    # ==================== 打印历史 ====================

    def get_history(self, limit: int = 50) -> list[dict]:
        return [
            {
                "id": h.id,
                "printer_name": h.printer_name,
                "printer_model": h.printer_model,
                "file_name": h.file_name,
                "material": h.material,
                "started_at": h.started_at.isoformat(),
                "completed_at": h.completed_at.isoformat(),
                "duration": h.duration,
                "success": h.success,
                "layer_count": h.layer_count,
                "material_used_grams": h.material_used_grams,
                "failure_reason": h.failure_reason,
            }
            for h in self._history[:limit]
        ]

    def get_history_stats(self) -> dict:
        total = len(self._history)
        success_count = sum(1 for h in self._history if h.success)
        fail_count = total - success_count
        total_time = sum(h.duration for h in self._history)
        success_rate = (success_count / total * 100) if total > 0 else 0
        return {
            "total": total,
            "success": success_count,
            "failed": fail_count,
            "total_time": total_time,
            "success_rate": round(success_rate, 1),
        }

    def export_history_csv(self) -> str:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "打印机", "型号", "文件名", "材料", "开始时间",
                          "结束时间", "耗时(秒)", "成功", "层数", "失败原因"])
        for h in self._history:
            writer.writerow([
                h.id, h.printer_name, h.printer_model, h.file_name,
                h.material, h.started_at.isoformat(), h.completed_at.isoformat(),
                h.duration, "是" if h.success else "否",
                h.layer_count, h.failure_reason,
            ])
        return output.getvalue()

    def clear_history(self):
        self._history = []
        self._save_history()

    # ==================== 耗材库存 ====================

    def add_filament(self, material: str, brand: str, color: str,
                     color_name: str, total_weight: float, price: float = 0,
                     spool_weight: float = 0, purchase_date: str = "",
                     notes: str = "") -> FilamentStock:
        filament = FilamentStock(
            id=str(uuid.uuid4())[:8],
            material=material,
            brand=brand,
            color=color,
            color_name=color_name,
            total_weight=total_weight,
            remaining_weight=total_weight - spool_weight,
            price=price,
            spool_weight=spool_weight,
            purchase_date=purchase_date,
            notes=notes,
        )
        self._filaments.append(filament)
        self._save_filaments()
        self._notify()
        return filament

    def update_filament(self, filament_id: str, **kwargs):
        for f in self._filaments:
            if f.id == filament_id:
                for key, value in kwargs.items():
                    if hasattr(f, key):
                        setattr(f, key, value)
                self._save_filaments()
                self._notify()
                return

    def remove_filament(self, filament_id: str):
        self._filaments = [f for f in self._filaments if f.id != filament_id]
        self._save_filaments()
        self._notify()

    def use_filament(self, filament_id: str, amount: float):
        for f in self._filaments:
            if f.id == filament_id:
                f.remaining_weight = max(0, f.remaining_weight - amount)
                self._save_filaments()
                self._notify()
                return

    def get_filaments(self) -> list[dict]:
        return [
            {
                "id": f.id,
                "material": f.material,
                "brand": f.brand,
                "color": f.color,
                "color_name": f.color_name,
                "total_weight": f.total_weight,
                "remaining_weight": f.remaining_weight,
                "usage_percent": round((1 - f.remaining_weight / max(f.total_weight - f.spool_weight, 1)) * 100, 1),
                "price": f.price,
                "spool_weight": f.spool_weight,
                "purchase_date": f.purchase_date,
                "notes": f.notes,
            }
            for f in self._filaments
        ]

    # ==================== 温度历史 ====================

    def get_temperature_history(self, printer_id: str, limit: int = 100) -> list[dict]:
        records = self._temp_history.get(printer_id, deque())
        items = list(records)[-limit:]
        return [
            {
                "timestamp": r.timestamp.isoformat(),
                "nozzle_temp": r.nozzle_temp,
                "bed_temp": r.bed_temp,
                "chamber_temp": r.chamber_temp,
            }
            for r in items
        ]

    # ==================== FRC 机器人管理 ====================

    def _load_robots(self):
        path = os.path.join(DATA_DIR, "robots.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    self._robots.append(Robot(
                        id=item["id"],
                        name=item["name"],
                        year=item.get("year", "2026"),
                        type=item.get("type", "competition"),
                        notes=item.get("notes", ""),
                    ))
            except Exception as e:
                logger.error(f"Failed to load robots: {e}")

    def _save_robots(self):
        path = os.path.join(DATA_DIR, "robots.json")
        data = [{"id": r.id, "name": r.name, "year": r.year, "type": r.type, "notes": r.notes} for r in self._robots]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def add_robot(self, name: str, year: str = "2026", type: str = "competition", notes: str = "") -> Robot:
        robot = Robot(id=str(uuid.uuid4())[:8], name=name, year=year, type=type, notes=notes)
        self._robots.append(robot)
        self._save_robots()
        self._notify()
        return robot

    def remove_robot(self, robot_id: str):
        self._robots = [r for r in self._robots if r.id != robot_id]
        self._save_robots()
        self._notify()

    def get_robots(self) -> list[dict]:
        return [
            {"id": r.id, "name": r.name, "year": r.year, "type": r.type, "notes": r.notes}
            for r in self._robots
        ]

    # ==================== FRC 零件库 ====================

    def _init_frc_parts_library(self):
        path = os.path.join(DATA_DIR, "parts_library.json")
        if not os.path.exists(path):
            default_parts = [
                PartTemplate("gusset_90", "90度连接件", "结构件", "标准90度角连接件", "PETG", 45, 25, "30%", 4, "用于底盘框架连接"),
                PartTemplate("gusset_60", "60度连接件", "结构件", "60度角连接件", "PETG", 40, 22, "30%", 4, "三角形框架连接"),
                PartTemplate("spacer_6mm", "6mm垫片", "垫片", "6mm内径精密垫片", "PLA", 5, 2, "100%", 5, "轴间距调整"),
                PartTemplate("spacer_8mm", "8mm垫片", "垫片", "8mm内径精密垫片", "PLA", 6, 2, "100%", 5, "轴间距调整"),
                PartTemplate("bearing_block", "轴承座", "传动件", "标准FRC轴承座", "PETG", 60, 35, "30%", 4, "适配1/2\"六角轴"),
                PartTemplate("sensor_mount", "传感器座", "传感器座", "通用光电/限位传感器支架", "PLA", 30, 12, "20%", 3, "适配标准FRC传感器"),
                PartTemplate("camera_mount", "摄像头支架", "传感器座", "USB摄像头安装支架", "PETG", 50, 20, "20%", 3, "可调角度"),
                PartTemplate("motor_plate", "电机安装板", "传动件", "CIM/NEO电机安装板", "PETG", 90, 55, "40%", 5, "加强结构"),
                PartTemplate("pulley_guard", "同步轮护罩", "安全件", "同步带轮防护罩", "PLA", 25, 10, "15%", 2, "安全防护"),
                PartTemplate("wire_clip", "线缆卡扣", "电气件", "线缆固定卡扣", "PLA", 8, 3, "20%", 3, "线缆管理"),
                PartTemplate("bumper_corner", "保险杠角", "保险杠", "保险杠转角保护件", "TPU", 35, 18, "50%", 3, "需要柔性材料"),
                PartTemplate("battery_holder", "电池支架", "电气件", "12V电池固定支架", "PETG", 70, 45, "30%", 4, "适配标准FRC电池"),
                PartTemplate("pneumatic_mount", "气动元件座", "气动件", "气缸/电磁阀安装座", "PETG", 40, 20, "30%", 3, "标准气动接口"),
                PartTemplate("encoder_mount", "编码器座", "传感器座", "旋转编码器安装座", "PLA", 25, 10, "30%", 3, "精密定位"),
                PartTemplate("shaft_collar", "轴套", "传动件", "轴限位套环", "PETG", 15, 8, "50%", 4, "1/2\"六角轴用"),
                PartTemplate("climber_hook", "爬升钩", "爬升机构", "爬升机构挂钩", "PETG", 120, 80, "60%", 6, "高负载部件"),
                PartTemplate("intake_roller", "吸 intake 滚轮", "Intake", "吸球机构滚轮", "TPU", 40, 22, "30%", 4, "需要柔性材料"),
                PartTemplate("bumper_standoff", "保险杠支架", "保险杠", "保险杠固定支架", "PETG", 30, 15, "40%", 4, "适配标准保险杠"),
                PartTemplate("gearbox_spacer", "变速箱垫片", "传动件", "变速箱精密垫片", "PLA", 10, 4, "100%", 5, "高精度要求"),
                PartTemplate("limit_switch_trigger", "限位触发片", "传感器座", "限位开关触发片", "PLA", 8, 3, "50%", 3, "可调角度"),
            ]
            self._save_parts_library(default_parts)
        else:
            self._load_parts_library()

    def _load_parts_library(self):
        path = os.path.join(DATA_DIR, "parts_library.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._parts_library: list[PartTemplate] = []
                for item in data:
                    self._parts_library.append(PartTemplate(
                        id=item["id"],
                        name=item["name"],
                        category=item.get("category", ""),
                        description=item.get("description", ""),
                        recommended_material=item.get("recommended_material", "PLA"),
                        estimated_time=item.get("estimated_time", 0),
                        filament_grams=item.get("filament_grams", 0),
                        infill=item.get("infill", "20%"),
                        wall_loops=item.get("wall_loops", 3),
                        notes=item.get("notes", ""),
                    ))
            except Exception as e:
                logger.error(f"Failed to load parts library: {e}")
                self._parts_library: list[PartTemplate] = []

    def _save_parts_library(self, parts: list[PartTemplate] = None):
        if parts is not None:
            self._parts_library = parts
        path = os.path.join(DATA_DIR, "parts_library.json")
        data = [{
            "id": p.id, "name": p.name, "category": p.category,
            "description": p.description, "recommended_material": p.recommended_material,
            "estimated_time": p.estimated_time, "filament_grams": p.filament_grams,
            "infill": p.infill, "wall_loops": p.wall_loops, "notes": p.notes,
        } for p in self._parts_library]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get_parts_library(self, category: str = None) -> list[dict]:
        parts = self._parts_library
        if category:
            parts = [p for p in parts if p.category == category]
        return [{
            "id": p.id, "name": p.name, "category": p.category,
            "description": p.description, "recommended_material": p.recommended_material,
            "estimated_time": p.estimated_time, "filament_grams": p.filament_grams,
            "infill": p.infill, "wall_loops": p.wall_loops, "notes": p.notes,
        } for p in parts]

    def get_parts_categories(self) -> list[str]:
        cats = set()
        for p in self._parts_library:
            cats.add(p.category)
        return sorted(cats)

    # ==================== 零件状态看板 ====================

    def get_parts_board(self, robot_id: str = None) -> list[dict]:
        items = self._queue
        if robot_id:
            items = [q for q in items if getattr(q, 'robot_id', '') == robot_id]
        return [
            {
                "id": q.id,
                "part_name": q.file_name,
                "printer_id": q.printer_id,
                "printer_name": self._printers.get(q.printer_id, Printer(id="", name="Unknown")).name,
                "robot_id": getattr(q, 'robot_id', ''),
                "robot_name": self._get_robot_name(getattr(q, 'robot_id', '')),
                "subsystem": getattr(q, 'subsystem', ''),
                "assigned_to": getattr(q, 'assigned_to', ''),
                "part_status": getattr(q, 'part_status', 'needed'),
                "material": q.material,
                "priority": q.priority,
                "created_at": q.created_at.isoformat(),
                "notes": q.notes,
            }
            for q in items
        ]

    def _get_robot_name(self, robot_id: str) -> str:
        for r in self._robots:
            if r.id == robot_id:
                return r.name
        return ""

    def update_part_status(self, queue_id: str, part_status: str):
        for item in self._queue:
            if item.id == queue_id:
                if not hasattr(item, 'part_status'):
                    item.part_status = 'needed'
                item.part_status = part_status
                self._save_queue()
                self._notify()
                return

    # ==================== 比赛管理 ====================

    def _load_competitions(self):
        path = os.path.join(DATA_DIR, "competitions.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    self._competitions.append(Competition(
                        id=item["id"],
                        name=item["name"],
                        start_date=item.get("start_date", ""),
                        end_date=item.get("end_date", ""),
                        location=item.get("location", ""),
                        notes=item.get("notes", ""),
                    ))
            except Exception as e:
                logger.error(f"Failed to load competitions: {e}")

    def _save_competitions(self):
        path = os.path.join(DATA_DIR, "competitions.json")
        data = [{
            "id": c.id, "name": c.name, "start_date": c.start_date,
            "end_date": c.end_date, "location": c.location, "notes": c.notes,
        } for c in self._competitions]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def add_competition(self, name: str, start_date: str = "", end_date: str = "",
                        location: str = "", notes: str = "") -> Competition:
        comp = Competition(
            id=str(uuid.uuid4())[:8], name=name, start_date=start_date,
            end_date=end_date, location=location, notes=notes,
        )
        self._competitions.append(comp)
        self._competitions.sort(key=lambda c: c.start_date)
        self._save_competitions()
        self._notify()
        return comp

    def remove_competition(self, comp_id: str):
        self._competitions = [c for c in self._competitions if c.id != comp_id]
        self._save_competitions()
        self._notify()

    def get_competitions(self) -> list[dict]:
        return [{
            "id": c.id, "name": c.name, "start_date": c.start_date,
            "end_date": c.end_date, "location": c.location, "notes": c.notes,
            "days_until": self._days_until(c.start_date),
        } for c in self._competitions]

    def _days_until(self, date_str: str) -> int:
        if not date_str:
            return -1
        try:
            target = datetime.strptime(date_str, "%Y-%m-%d")
            delta = (target - datetime.now()).days
            return max(delta, 0)
        except ValueError:
            return -1