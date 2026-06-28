"""
XplorePrint - Main Application
FRC Team 11019 Xplore
3D Printer Management Software for Bambu Lab Printers
"""

import logging
import os
from flask import Flask, render_template, request, jsonify, Response
from flask_socketio import SocketIO

from printermanager.printermanager import PrinterManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__, template_folder="web/templates", static_folder="web/static")
app.config["SECRET_KEY"] = "xploreprint-11019-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

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
    return jsonify({"success": True, "path": save_path, "filename": file.filename})


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


@socketio.on("connect")
def handle_connect():
    socketio.emit("printer_update", manager.get_all_printer_data())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"XplorePrint starting on port {port}")
    socketio.run(app, host="0.0.0.0", port=port, debug=True)