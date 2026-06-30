"""
XplorePrint - Main Application
FRC Team 11019 Xplore
3D Printer Management Software for Bambu Lab Printers
"""

import logging
import logging.handlers
import os
import sys
from flask import Flask, render_template, request, jsonify, Response, send_file
from flask_socketio import SocketIO

from printermanager.printermanager import PrinterManager

# ==================== 彩色日志配置 ====================

LOG_DIR = os.path.join(os.path.dirname(__file__), "data", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

LOG_COLORS = {
    "DEBUG": "\033[90m",
    "INFO": "\033[92m",
    "WARNING": "\033[93m",
    "ERROR": "\033[91m",
    "CRITICAL": "\033[41m\033[97m",
}
RESET = "\033[0m"
TIMESTAMP_COLOR = "\033[96m"
NAME_COLOR = "\033[94m"
MSG_COLOR = "\033[37m"


class ColoredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        level_color = LOG_COLORS.get(record.levelname, "")
        record.colored_levelname = f"{level_color}{record.levelname:<8}{RESET}"
        record.colored_timestamp = f"{TIMESTAMP_COLOR}{self.formatTime(record, self.datefmt)}{RESET}"
        record.colored_name = f"{NAME_COLOR}{record.name}{RESET}"
        record.colored_msg = f"{MSG_COLOR}{record.getMessage()}{RESET}"
        if record.exc_info and record.exc_info[0]:
            record.colored_exc = f"\033[91m{self.formatException(record.exc_info)}{RESET}"
        else:
            record.colored_exc = ""
        return f"{record.colored_timestamp} [{record.colored_levelname}] {record.colored_name}: {record.colored_msg}"


# 控制台 handler（彩色）
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.DEBUG)
console_handler.setFormatter(ColoredFormatter(
    "%(colored_timestamp)s [%(colored_levelname)s] %(colored_name)s: %(colored_msg)s"
))

# 文件 handler（无颜色，带轮转）
file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, "xploreprint.log"),
    maxBytes=5 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter(
    "%(asctime)s [%(levelname)-8s] %(name)s: %(message)s"
))

# 应用根 logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)
root_logger.handlers.clear()
root_logger.addHandler(console_handler)
root_logger.addHandler(file_handler)

logger = logging.getLogger(__name__)

# 抑制第三方库的冗余 DEBUG 日志
logging.getLogger("bambulabs_api").setLevel(logging.WARNING)

app = Flask(__name__, template_folder="web/templates", static_folder="web/static")
app.config["SECRET_KEY"] = "xploreprint-11019-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "data", "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

manager = PrinterManager()


def on_printer_update(data):
    socketio.emit("printer_update", data)


manager.register_callback(on_printer_update)


@app.route("/")
def index():
    return render_template("index.html", team_name="Xplore", team_number="11019")


# ==================== 打印机 API ====================

@app.route("/api/printers", methods=["GET"])
def get_printers():
    return jsonify(manager.get_all_printer_data())


@app.route("/api/printers", methods=["POST"])
def add_printer():
    data = request.json
    try:
        printer = manager.add_printer(
            name=data["name"],
            ip_address=data["ip_address"],
            access_code=data["access_code"],
            serial_number=data["serial_number"],
            model=data.get("model", "Unknown"),
        )
        return jsonify({"status": "ok", "printer": manager._printer_to_dict(printer)})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/printers/<printer_id>", methods=["DELETE"])
def remove_printer(printer_id):
    manager.remove_printer(printer_id)
    return jsonify({"status": "ok"})


@app.route("/api/printers/<printer_id>/connect", methods=["POST"])
def connect_printer(printer_id):
    manager.connect_printer(printer_id)
    return jsonify({"status": "ok"})


@app.route("/api/printers/<printer_id>/disconnect", methods=["POST"])
def disconnect_printer(printer_id):
    manager.disconnect_printer(printer_id)
    return jsonify({"status": "ok"})


@app.route("/api/printers/<printer_id>/command", methods=["POST"])
def send_command(printer_id):
    data = request.json
    command = data.get("command")
    manager.send_command(printer_id, command, **data.get("params", {}))
    return jsonify({"status": "ok"})


@app.route("/api/printers/<printer_id>/temperature", methods=["GET"])
def get_temperature_history(printer_id):
    limit = request.args.get("limit", 100, type=int)
    return jsonify(manager.get_temperature_history(printer_id, limit))


@app.route("/api/printers/<printer_id>/ams", methods=["GET"])
def get_ams_data(printer_id):
    return jsonify(manager.get_ams_data(printer_id))


@app.route("/api/connect_all", methods=["POST"])
def connect_all():
    manager.connect_all()
    return jsonify({"status": "ok"})


@app.route("/api/disconnect_all", methods=["POST"])
def disconnect_all():
    manager.disconnect_all()
    return jsonify({"status": "ok"})


@app.route("/api/printers/<printer_id>/files", methods=["GET"])
def list_printer_files(printer_id):
    return jsonify(manager.list_printer_files(printer_id))


@app.route("/api/printers/<printer_id>/files/<filename>", methods=["DELETE"])
def delete_printer_file(printer_id, filename):
    return jsonify(manager.delete_printer_file(printer_id, filename))


# ==================== 服务器模型文件存储 API ====================

@app.route("/api/storage/files", methods=["GET"])
def list_storage_files():
    import time as _time
    import os as _os
    files = []
    for fname in _os.listdir(STORAGE_DIR):
        fpath = _os.path.join(STORAGE_DIR, fname)
        if _os.path.isfile(fpath):
            stat = _os.stat(fpath)
            ext = _os.path.splitext(fname)[1].lower()
            files.append({
                "name": fname,
                "size": stat.st_size,
                "size_mb": round(stat.st_size / 1024 / 1024, 2),
                "modified": stat.st_mtime,
                "ext": ext,
            })
    files.sort(key=lambda x: x["modified"], reverse=True)
    return jsonify(files)


@app.route("/api/storage/upload", methods=["POST"])
def upload_to_storage():
    if "file" not in request.files:
        return jsonify({"success": False, "message": "未选择文件"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"success": False, "message": "文件名为空"}), 400
    import os as _os
    safe_name = _os.path.basename(file.filename)
    save_path = _os.path.join(STORAGE_DIR, safe_name)
    file.save(save_path)
    logger.info(f"Saved to storage: {safe_name} ({_os.path.getsize(save_path)} bytes)")
    return jsonify({"success": True, "filename": safe_name, "message": "文件已保存到服务器"})


@app.route("/api/storage/files/<filename>", methods=["DELETE"])
def delete_storage_file(filename):
    import os as _os
    fpath = _os.path.join(STORAGE_DIR, _os.path.basename(filename))
    if _os.path.exists(fpath):
        _os.remove(fpath)
        return jsonify({"success": True, "message": "已删除"})
    return jsonify({"success": False, "message": "文件不存在"}), 404


@app.route("/api/storage/send-to-printer", methods=["POST"])
def send_to_printer():
    data = request.json
    filename = data.get("filename", "")
    printer_id = data.get("printer_id", "")
    if not filename or not printer_id:
        return jsonify({"success": False, "message": "缺少参数"}), 400
    import os as _os
    fpath = _os.path.join(STORAGE_DIR, _os.path.basename(filename))
    if not _os.path.exists(fpath):
        return jsonify({"success": False, "message": "服务器文件不存在"}), 404
    result = manager.upload_to_printer(printer_id, fpath, filename)
    return jsonify(result)


@app.route("/api/storage/print", methods=["POST"])
def start_print_from_storage():
    data = request.json
    filename = data.get("filename", "")
    printer_id = data.get("printer_id", "")
    if not filename or not printer_id:
        return jsonify({"success": False, "message": "缺少参数"}), 400
    import os as _os
    fpath = _os.path.join(STORAGE_DIR, _os.path.basename(filename))
    if not _os.path.exists(fpath):
        return jsonify({"success": False, "message": "服务器文件不存在"}), 404
    upload_result = manager.upload_to_printer(printer_id, fpath, filename)
    if not upload_result.get("success"):
        return jsonify({"success": False, "message": "上传到打印机失败: " + upload_result.get("message", "未知错误")})
    return jsonify(manager.start_print(
        printer_id,
        filename,
        plate_number=data.get("plate_number", 1),
        use_ams=data.get("use_ams", True),
        ams_mapping=data.get("ams_mapping"),
        flow_calibration=data.get("flow_calibration", True),
    ))


# ==================== 日志导出 API ====================

@app.route("/api/logs/download", methods=["GET"])
def download_logs():
    log_path = os.path.join(LOG_DIR, "xploreprint.log")
    if not os.path.exists(log_path):
        return jsonify({"success": False, "message": "日志文件不存在"}), 404
    return send_file(log_path, as_attachment=True, download_name="xploreprint.log", mimetype="text/plain")


@app.route("/api/logs/view", methods=["GET"])
def view_logs():
    lines = request.args.get("lines", 200, type=int)
    log_path = os.path.join(LOG_DIR, "xploreprint.log")
    if not os.path.exists(log_path):
        return jsonify({"success": False, "message": "日志文件不存在"}), 404
    import os as _os
    file_size = _os.path.getsize(log_path)
    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    all_lines = content.strip().split("\n")
    recent = all_lines[-lines:] if len(all_lines) > lines else all_lines
    return jsonify({
        "success": True,
        "total_lines": len(all_lines),
        "lines": recent,
        "file_size": file_size,
        "file_size_kb": round(file_size / 1024, 1),
    })


@app.route("/api/printers/<printer_id>/upload", methods=["POST"])
def upload_to_printer(printer_id):
    if "file" not in request.files:
        return jsonify({"success": False, "message": "未选择文件"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"success": False, "message": "未选择文件"}), 400

    import tempfile
    import os as _os
    with tempfile.NamedTemporaryFile(delete=False, suffix=_os.path.splitext(file.filename)[1]) as tmp:
        file.save(tmp.name)
        result = manager.upload_to_printer(printer_id, tmp.name, file.filename)
    _os.unlink(tmp.name)
    return jsonify(result)


@app.route("/api/printers/<printer_id>/print", methods=["POST"])
def start_print(printer_id):
    data = request.json
    filename = data.get("filename", "")
    if not filename:
        return jsonify({"success": False, "message": "未指定文件名"}), 400
    return jsonify(manager.start_print(
        printer_id,
        filename,
        plate_number=data.get("plate_number", 1),
        use_ams=data.get("use_ams", True),
        ams_mapping=data.get("ams_mapping"),
        flow_calibration=data.get("flow_calibration", True),
    ))


@app.route("/api/printers/<printer_id>/camera", methods=["GET"])
def get_camera_url(printer_id):
    url = manager.get_camera_url(printer_id)
    return jsonify({"url": url})


@app.route("/api/printers/<printer_id>/video")
def video_stream(printer_id):
    return _snapshot_response(printer_id)


@app.route("/api/printers/<printer_id>/snapshot")
def video_snapshot(printer_id):
    return _snapshot_response(printer_id)


def _snapshot_response(printer_id):
    logger = logging.getLogger(__name__)
    client = manager._clients.get(printer_id)
    if not client:
        return "Printer not connected", 404

    frame = client.get_camera_frame()
    if frame:
        return Response(
            frame,
            mimetype='image/jpeg',
            headers={'Cache-Control': 'no-cache, no-store, must-revalidate'}
        )
    return Response(status=502)


@app.route("/api/stats", methods=["GET"])
def get_stats():
    return jsonify(manager.get_stats())


# ==================== 打印队列 API ====================

@app.route("/api/queue", methods=["GET"])
def get_queue():
    printer_id = request.args.get("printer_id")
    return jsonify(manager.get_queue(printer_id))


@app.route("/api/queue", methods=["POST"])
def add_to_queue():
    data = request.json
    try:
        item = manager.add_to_queue(
            printer_id=data["printer_id"],
            file_name=data["file_name"],
            material=data.get("material", "PLA"),
            color=data.get("color", "#3B82F6"),
            estimated_time=data.get("estimated_time", 0),
            priority=data.get("priority", 0),
            notes=data.get("notes", ""),
            robot_id=data.get("robot_id", ""),
            subsystem=data.get("subsystem", ""),
            assigned_to=data.get("assigned_to", ""),
            part_status=data.get("part_status", "needed"),
        )
        return jsonify({"status": "ok", "item": {
            "id": item.id,
            "printer_id": item.printer_id,
            "file_name": item.file_name,
            "material": item.material,
            "priority": item.priority,
            "status": item.status.value,
        }})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/queue/<queue_id>", methods=["DELETE"])
def remove_from_queue(queue_id):
    manager.remove_from_queue(queue_id)
    return jsonify({"status": "ok"})


@app.route("/api/queue/<queue_id>", methods=["PUT"])
def update_queue_item(queue_id):
    data = request.json
    manager.update_queue_item(queue_id, **data)
    return jsonify({"status": "ok"})


@app.route("/api/queue/clear", methods=["POST"])
def clear_queue():
    printer_id = request.args.get("printer_id")
    manager.clear_queue(printer_id)
    return jsonify({"status": "ok"})


@app.route("/api/queue/sort", methods=["POST"])
def sort_queue():
    data = request.json or {}
    mode = data.get("mode", "default")
    result = manager.sort_queue(mode)
    return jsonify({"status": "ok", "queue": result})


@app.route("/api/queue/reorder", methods=["POST"])
def reorder_queue():
    data = request.json or {}
    ordered_ids = data.get("ordered_ids", [])
    result = manager.reorder_queue(ordered_ids)
    return jsonify({"status": "ok", "queue": result})


# ==================== 智能调度 API ====================

@app.route("/api/schedule/preview", methods=["GET"])
def schedule_preview():
    preview = manager.auto_schedule_preview()
    return jsonify(preview)


@app.route("/api/schedule/apply", methods=["POST"])
def schedule_apply():
    queue = manager.apply_auto_schedule()
    return jsonify({"status": "ok", "queue": queue})


@app.route("/api/schedule/start", methods=["POST"])
def schedule_start():
    result = manager.start_next_jobs()
    return jsonify(result)


# ==================== 队列文件上传 ====================

@app.route("/api/queue/upload", methods=["POST"])
def upload_queue_file():
    if "file" not in request.files:
        return jsonify({"success": False, "message": "未选择文件"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"success": False, "message": "未选择文件"}), 400

    import os as _os
    import uuid as _uuid
    queue_dir = _os.path.join(_os.path.dirname(__file__), "data", "queue_files")
    _os.makedirs(queue_dir, exist_ok=True)
    safe_name = f"{_uuid.uuid4().hex}_{file.filename}"
    save_path = _os.path.join(queue_dir, safe_name)
    file.save(save_path)

    material = request.form.get("material", "PLA")
    analysis = None
    fname_lower = file.filename.lower()
    if fname_lower.endswith(".gcode") or fname_lower.endswith(".gcode.3mf"):
        try:
            from printermanager.gcode_parser import quick_analyze
            logger.info(f"Parsing G-code: {file.filename} ({save_path})")
            analysis = quick_analyze(save_path, material)
            logger.info(f"G-code parsed: {analysis}")
        except Exception as e:
            logger.error(f"G-code parse failed for {file.filename}: {e}", exc_info=True)
            analysis = {"error": str(e)}

    return jsonify({
        "success": True,
        "path": save_path,
        "filename": file.filename,
        "analysis": analysis,
    })


# ==================== G-code 解析 ====================

@app.route("/api/gcode/analyze", methods=["POST"])
def analyze_gcode():
    from printermanager.gcode_parser import quick_analyze
    data = request.json or {}
    file_path = data.get("path", "")
    material = data.get("material", "PLA")
    if not file_path:
        return jsonify({"success": False, "message": "未提供文件路径"}), 400
    import os as _os
    if not _os.path.exists(file_path):
        return jsonify({"success": False, "message": "文件不存在"}), 404
    try:
        result = quick_analyze(file_path, material)
        return jsonify({"success": True, "analysis": result})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# ==================== 诊断 API ====================

@app.route("/api/diagnostics/ping", methods=["GET"])
def server_ping():
    import time as _time
    return jsonify({"status": "ok", "timestamp": _time.time(), "message": "pong"})


@app.route("/api/diagnostics/printer-latency", methods=["POST"])
def printer_latency():
    data = request.json or {}
    printer_id = data.get("printer_id", "")
    if not printer_id:
        return jsonify({"success": False, "message": "未指定打印机"}), 400
    import time as _time
    t0 = _time.time()
    result = manager.test_printer_latency(printer_id)
    elapsed = round((_time.time() - t0) * 1000, 1)
    return jsonify({
        "success": result.get("success", False),
        "latency_ms": elapsed,
        "printer_response_ms": result.get("printer_response_ms"),
        "message": result.get("message", ""),
    })


@app.route("/api/printer/<printer_id>/hms", methods=["GET"])
def printer_hms_error(printer_id):
    result = manager.get_hms_error(printer_id)
    return jsonify(result)


# ==================== 打印历史 API ====================

@app.route("/api/history", methods=["GET"])
def get_history():
    limit = request.args.get("limit", 50, type=int)
    return jsonify(manager.get_history(limit))


@app.route("/api/history/stats", methods=["GET"])
def get_history_stats():
    return jsonify(manager.get_history_stats())


@app.route("/api/history/export", methods=["GET"])
def export_history():
    csv_data = manager.export_history_csv()
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=xploreprint_history.csv"}
    )


@app.route("/api/history/clear", methods=["POST"])
def clear_history():
    manager.clear_history()
    return jsonify({"status": "ok"})


# ==================== 耗材库存 API ====================

@app.route("/api/filaments", methods=["GET"])
def get_filaments():
    return jsonify(manager.get_filaments())


@app.route("/api/filaments", methods=["POST"])
def add_filament():
    data = request.json
    try:
        filament = manager.add_filament(
            material=data.get("material", "PLA"),
            brand=data.get("brand", ""),
            color=data.get("color", "#3B82F6"),
            color_name=data.get("color_name", ""),
            total_weight=data.get("total_weight", 1000),
            price=data.get("price", 0),
            spool_weight=data.get("spool_weight", 0),
            purchase_date=data.get("purchase_date", ""),
            notes=data.get("notes", ""),
        )
        return jsonify({"status": "ok", "id": filament.id})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/filaments/<filament_id>", methods=["DELETE"])
def remove_filament(filament_id):
    manager.remove_filament(filament_id)
    return jsonify({"status": "ok"})


@app.route("/api/filaments/<filament_id>", methods=["PUT"])
def update_filament(filament_id):
    data = request.json
    manager.update_filament(filament_id, **data)
    return jsonify({"status": "ok"})


@app.route("/api/filaments/<filament_id>/use", methods=["POST"])
def use_filament(filament_id):
    data = request.json
    amount = data.get("amount", 0)
    manager.use_filament(filament_id, amount)
    return jsonify({"status": "ok"})


# ==================== FRC 机器人管理 API ====================

@app.route("/api/robots", methods=["GET"])
def get_robots():
    return jsonify(manager.get_robots())


@app.route("/api/robots", methods=["POST"])
def add_robot():
    data = request.json
    try:
        robot = manager.add_robot(
            name=data["name"],
            year=data.get("year", "2026"),
            type=data.get("type", "competition"),
            notes=data.get("notes", ""),
        )
        return jsonify({"status": "ok", "id": robot.id})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/robots/<robot_id>", methods=["DELETE"])
def remove_robot(robot_id):
    manager.remove_robot(robot_id)
    return jsonify({"status": "ok"})


# ==================== FRC 零件库 API ====================

@app.route("/api/parts/library", methods=["GET"])
def get_parts_library():
    category = request.args.get("category")
    return jsonify(manager.get_parts_library(category))


@app.route("/api/parts/categories", methods=["GET"])
def get_parts_categories():
    return jsonify(manager.get_parts_categories())


@app.route("/api/parts/library", methods=["POST"])
def add_part_template():
    data = request.json
    if not data.get("name"):
        return jsonify({"status": "error", "message": "零件名称不能为空"}), 400
    result = manager.add_part_template(data)
    return jsonify({"status": "ok", "part": result})


@app.route("/api/parts/library/<part_id>", methods=["PUT"])
def update_part_template(part_id):
    data = request.json
    result = manager.update_part_template(part_id, data)
    if result is None:
        return jsonify({"status": "error", "message": "零件不存在"}), 404
    return jsonify({"status": "ok", "part": result})


@app.route("/api/parts/library/<part_id>", methods=["DELETE"])
def delete_part_template(part_id):
    if manager.delete_part_template(part_id):
        return jsonify({"status": "ok"})
    return jsonify({"status": "error", "message": "零件不存在"}), 404


@app.route("/api/parts/library/<part_id>/files", methods=["POST"])
def upload_part_file(part_id):
    if "file" not in request.files:
        return jsonify({"status": "error", "message": "未选择文件"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"status": "error", "message": "文件名为空"}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".gcode", ".3mf"):
        return jsonify({"status": "error", "message": "仅支持 .gcode 和 .3mf 文件"}), 400
    part_dir = os.path.join(DATA_DIR, "parts_files", part_id)
    os.makedirs(part_dir, exist_ok=True)
    safe_name = f"{int(time.time()*1000)}_{file.filename}"
    save_path = os.path.join(part_dir, safe_name)
    file.save(save_path)
    printer_model = request.form.get("printer_model", "").strip()
    version = request.form.get("version", "").strip()
    result = manager.upload_part_file(part_id, file.filename, save_path, printer_model, version)
    if result is None:
        os.remove(save_path)
        return jsonify({"status": "error", "message": "零件不存在"}), 404
    return jsonify({"status": "ok", "part_file": result})


@app.route("/api/parts/library/<part_id>/files/<path:filepath>", methods=["DELETE"])
def delete_part_file(part_id, filepath):
    full_path = os.path.join(DATA_DIR, "parts_files", part_id, filepath)
    if manager.delete_part_file(part_id, full_path):
        if os.path.exists(full_path):
            os.remove(full_path)
        return jsonify({"status": "ok"})
    return jsonify({"status": "error", "message": "文件不存在"}), 404


@app.route("/api/parts/files/<part_id>/<path:filename>", methods=["GET"])
def download_part_file(part_id, filename):
    filepath = os.path.join(DATA_DIR, "parts_files", part_id, filename)
    if not os.path.exists(filepath):
        return jsonify({"status": "error", "message": "文件不存在"}), 404
    return send_file(filepath, as_attachment=True, download_name=os.path.basename(filename))


# ==================== 零件状态看板 API ====================

@app.route("/api/parts/board", methods=["GET"])
def get_parts_board():
    robot_id = request.args.get("robot_id")
    return jsonify(manager.get_parts_board(robot_id))


@app.route("/api/parts/<queue_id>/status", methods=["PUT"])
def update_part_status(queue_id):
    data = request.json
    manager.update_part_status(queue_id, data.get("part_status", "needed"))
    return jsonify({"status": "ok"})


# ==================== 比赛管理 API ====================

@app.route("/api/competitions", methods=["GET"])
def get_competitions():
    return jsonify(manager.get_competitions())


@app.route("/api/competitions", methods=["POST"])
def add_competition():
    data = request.json
    try:
        comp = manager.add_competition(
            name=data["name"],
            start_date=data.get("start_date", ""),
            end_date=data.get("end_date", ""),
            location=data.get("location", ""),
            notes=data.get("notes", ""),
        )
        return jsonify({"status": "ok", "id": comp.id})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/competitions/<comp_id>", methods=["DELETE"])
def remove_competition(comp_id):
    manager.remove_competition(comp_id)
    return jsonify({"status": "ok"})


# ==================== 赛场工具 API ====================

@app.route("/api/competition/drives", methods=["GET"])
def get_drives():
    import subprocess
    import json as _json
    try:
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-Command",
                "Get-WmiObject Win32_LogicalDisk -Filter 'DriveType=2' | "
                "Select-Object DeviceID, VolumeName, "
                "@{N='FreeSpaceGB';E={[math]::Round($_.FreeSpace/1GB,1)}}, "
                "@{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}} | "
                "ConvertTo-Json"
            ],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return jsonify({"success": False, "message": "驱动器检测失败", "drives": []})
        raw = result.stdout.strip()
        if not raw:
            drives = []
        else:
            parsed = _json.loads(raw)
            drives = [parsed] if isinstance(parsed, dict) else parsed
        return jsonify({"success": True, "drives": drives})
    except Exception as e:
        logger.error(f"Failed to detect drives: {e}")
        return jsonify({"success": False, "message": str(e), "drives": []})


@app.route("/api/competition/export", methods=["POST"])
def export_to_sd():
    import shutil
    import os as _os
    data = request.json
    drive = data.get("drive", "")
    filenames = data.get("filenames", [])
    target_path = data.get("target_path", "").strip().strip("\\").strip("/")

    if not drive:
        return jsonify({"success": False, "message": "未选择目标驱动器"}), 400
    if not filenames:
        return jsonify({"success": False, "message": "未选择文件"}), 400
    if not _os.path.exists(drive):
        return jsonify({"success": False, "message": f"驱动器 {drive} 不存在"}), 404

    if target_path:
        export_dir = _os.path.join(drive, target_path)
    else:
        export_dir = drive.rstrip("\\") + "\\"
    _os.makedirs(export_dir, exist_ok=True)

    copied = []
    failed = []
    total_size = 0

    for fname in filenames:
        src = _os.path.join(STORAGE_DIR, _os.path.basename(fname))
        dst = _os.path.join(export_dir, _os.path.basename(fname))
        if not _os.path.exists(src):
            failed.append({"name": fname, "reason": "源文件不存在"})
            continue
        try:
            shutil.copy2(src, dst)
            fsize = _os.path.getsize(dst)
            total_size += fsize
            copied.append({"name": fname, "size_mb": round(fsize / 1024 / 1024, 2)})
            logger.info(f"Exported {fname} to {drive}")
        except Exception as e:
            failed.append({"name": fname, "reason": str(e)})
            logger.error(f"Export failed: {fname} -> {drive}: {e}")

    return jsonify({
        "success": True,
        "export_dir": export_dir,
        "copied": copied,
        "failed": failed,
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "message": f"导出完成: {len(copied)} 成功, {len(failed)} 失败",
    })


@app.route("/api/competition/health", methods=["GET"])
def competition_health_check():
    results = []
    printers = manager.get_all_printer_data()
    for p in printers:
        issues = []
        if p.get("status") == "offline":
            issues.append("打印机离线")
        if p.get("hms_code", 0) != 0:
            issues.append(f"HMS 错误: {p.get('hms_code')}")
        if p.get("status") == "error":
            issues.append("打印机报错")
        results.append({
            "name": p.get("name", "Unknown"),
            "status": p.get("status", "offline"),
            "healthy": len(issues) == 0,
            "issues": issues,
            "nozzle_temp": p.get("nozzle_temp", 0),
            "bed_temp": p.get("bed_temp", 0),
            "print_progress": p.get("print_progress", 0),
        })

    storage_files = len(os.listdir(STORAGE_DIR)) if os.path.exists(STORAGE_DIR) else 0
    return jsonify({
        "success": True,
        "printers": results,
        "storage_files": storage_files,
        "total_printers": len(results),
        "healthy_printers": sum(1 for r in results if r["healthy"]),
    })


@socketio.on("connect")
def handle_connect():
    socketio.emit("printer_update", manager.get_all_printer_data())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"XplorePrint starting on port {port}")
    logger.debug("Debug logging enabled - verbose output active")
    logger.info(f"Log file: {os.path.join(LOG_DIR, 'xploreprint.log')}")
    socketio.run(app, host="0.0.0.0", port=port, debug=True)