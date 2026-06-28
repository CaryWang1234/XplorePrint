"""
XplorePrint - 3D Printer Data Models
FRC Team 11019 Xplore
"""

from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
from typing import Optional


class PrinterStatus(Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    PRINTING = "printing"
    PAUSED = "paused"
    ERROR = "error"
    IDLE = "idle"
    FINISHING = "finishing"


class PrinterModel(Enum):
    X1C = "X1 Carbon"
    X1 = "X1"
    P1S = "P1S"
    P1S_COMBO = "P1S Combo"
    P1P = "P1P"
    P2S = "P2S"
    A1 = "A1"
    A1_MINI = "A1 Mini"
    H2D = "H2D"
    H2S = "H2S"
    H2C = "H2C"
    X2D = "X2D"
    A2L = "A2L"
    UNKNOWN = "Unknown"


class QueueStatus(Enum):
    WAITING = "waiting"
    PRINTING = "printing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class MaterialType(Enum):
    PLA = "PLA"
    PETG = "PETG"
    ABS = "ABS"
    ASA = "ASA"
    TPU = "TPU"
    PC = "PC"
    PA = "PA"
    PVA = "PVA"
    OTHER = "Other"


class PartStatus(Enum):
    NEEDED = "needed"
    PRINTING = "printing"
    DONE = "done"
    INSTALLED = "installed"


class RobotSubsystem(Enum):
    DRIVETRAIN = "Drivetrain"
    INTAKE = "Intake"
    SHOOTER = "Shooter"
    CLIMBER = "Climber"
    ELEVATOR = "Elevator"
    ARM = "Arm"
    BUMPER = "Bumper"
    ELECTRONICS = "Electronics"
    PNEUMATICS = "Pneumatics"
    STRUCTURE = "Structure"
    OTHER = "Other"


@dataclass
class AMSStatus:
    tray_id: int = 0
    color: str = "#CCCCCC"
    material: str = "Unknown"
    temperature: float = 0.0
    remaining: float = 0.0


@dataclass
class Printer:
    id: str
    name: str
    model: PrinterModel = PrinterModel.UNKNOWN
    ip_address: str = ""
    access_code: str = ""
    serial_number: str = ""
    status: PrinterStatus = PrinterStatus.OFFLINE
    nozzle_temp: float = 0.0
    target_nozzle_temp: float = 0.0
    bed_temp: float = 0.0
    target_bed_temp: float = 0.0
    chamber_temp: float = 0.0
    print_progress: float = 0.0
    layer_num: int = 0
    total_layers: int = 0
    print_time_remaining: int = 0
    print_time_elapsed: int = 0
    ams_units: list[AMSStatus] = field(default_factory=list)
    current_file: str = ""
    last_updated: datetime = field(default_factory=datetime.now)
    error_message: str = ""
    wifi_signal: int = 0


@dataclass
class PrintJob:
    id: str
    printer_id: str
    file_name: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    status: str = "pending"
    material_used: float = 0.0
    print_time: int = 0
    success: bool = False


@dataclass
class QueueItem:
    id: str
    printer_id: str
    file_name: str
    material: str = "PLA"
    color: str = "#3B82F6"
    estimated_time: int = 0
    priority: int = 0
    status: QueueStatus = QueueStatus.WAITING
    created_at: datetime = field(default_factory=datetime.now)
    notes: str = ""
    robot_id: str = ""
    subsystem: str = ""
    assigned_to: str = ""
    part_status: str = "needed"


@dataclass
class PrintHistory:
    id: str
    printer_name: str
    printer_model: str
    file_name: str
    material: str
    started_at: datetime
    completed_at: datetime
    duration: int = 0
    success: bool = True
    layer_count: int = 0
    material_used_grams: float = 0.0
    failure_reason: str = ""


@dataclass
class FilamentStock:
    id: str
    material: str = "PLA"
    brand: str = ""
    color: str = "#3B82F6"
    color_name: str = ""
    total_weight: float = 1000.0
    remaining_weight: float = 1000.0
    price: float = 0.0
    spool_weight: float = 0.0
    purchase_date: str = ""
    notes: str = ""


@dataclass
class TemperatureRecord:
    timestamp: datetime = field(default_factory=datetime.now)
    nozzle_temp: float = 0.0
    bed_temp: float = 0.0
    chamber_temp: float = 0.0


@dataclass
class Robot:
    id: str
    name: str
    year: str = "2026"
    type: str = "competition"
    notes: str = ""


@dataclass
class PartFile:
    filename: str
    path: str = ""
    printer_model: str = ""
    version: str = ""
    upload_date: str = ""

@dataclass
class PartTemplate:
    id: str
    name: str
    category: str = ""
    description: str = ""
    recommended_material: str = "PLA"
    estimated_time: int = 0
    filament_grams: int = 0
    infill: str = "20%"
    wall_loops: int = 3
    notes: str = ""
    files: list[PartFile] = field(default_factory=list)


@dataclass
class Competition:
    id: str
    name: str
    start_date: str = ""
    end_date: str = ""
    location: str = ""
    notes: str = ""