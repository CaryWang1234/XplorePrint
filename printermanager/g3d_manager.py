"""
G3D - Git for 3D Prints Manager
FRC Team 11019 Xplore
Version control system for 3D print and CAD files
"""

import os
import json
import uuid
import shutil
import logging
from datetime import datetime

from printermanager.models import G3DProject, G3DCommit, G3DAssemblyInfo

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "g3d")
os.makedirs(DATA_DIR, exist_ok=True)

PROJECTS_FILE = os.path.join(DATA_DIR, "projects.json")


class G3DManager:
    def __init__(self):
        self._projects: list[G3DProject] = []
        self._load_projects()

    def _load_projects(self):
        if os.path.exists(PROJECTS_FILE):
            try:
                with open(PROJECTS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    self._projects.append(G3DProject(**item))
            except Exception as e:
                logger.error(f"Failed to load G3D projects: {e}")

    def _save_projects(self):
        with open(PROJECTS_FILE, "w", encoding="utf-8") as f:
            json.dump([{
                "id": p.id, "name": p.name, "description": p.description,
                "created_at": p.created_at, "updated_at": p.updated_at,
                "default_branch": p.default_branch,
                "file_count": p.file_count, "commit_count": p.commit_count,
                "visibility": getattr(p, "visibility", "public"),
                "tags": getattr(p, "tags", None) or [],
                "readme": getattr(p, "readme", ""),
            } for p in self._projects], f, indent=2, ensure_ascii=False)

    def _project_dir(self, project_id: str) -> str:
        return os.path.join(DATA_DIR, project_id)

    def _commits_file(self, project_id: str) -> str:
        return os.path.join(self._project_dir(project_id), "commits.json")

    def _load_commits(self, project_id: str) -> list[dict]:
        path = self._commits_file(project_id)
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load commits for {project_id}: {e}")
        return []

    def _save_commits(self, project_id: str, commits: list[dict]):
        os.makedirs(self._project_dir(project_id), exist_ok=True)
        with open(self._commits_file(project_id), "w", encoding="utf-8") as f:
            json.dump(commits, f, indent=2, ensure_ascii=False)

    def _update_project_stats(self, project: G3DProject):
        commits = self._load_commits(project.id)
        project.commit_count = len(commits)
        files_dir = os.path.join(self._project_dir(project.id), "latest")
        if os.path.exists(files_dir):
            project.file_count = len([f for f in os.listdir(files_dir)
                                       if os.path.isfile(os.path.join(files_dir, f))])
        else:
            project.file_count = 0

    def get_projects(self) -> list[dict]:
        result = []
        for p in self._projects:
            self._update_project_stats(p)
            result.append({
                "id": p.id, "name": p.name, "description": p.description,
                "created_at": p.created_at, "updated_at": p.updated_at,
                "default_branch": p.default_branch,
                "file_count": p.file_count, "commit_count": p.commit_count,
                "visibility": getattr(p, "visibility", "public"),
                "tags": getattr(p, "tags", None) or [],
                "readme": getattr(p, "readme", ""),
            })
        return result

    def get_project(self, project_id: str) -> dict | None:
        for p in self._projects:
            if p.id == project_id:
                self._update_project_stats(p)
                commits = self._load_commits(project_id)
                files = self._get_latest_files(project_id)
                assemblies = self._get_assemblies(project_id)
                return {
                    "id": p.id, "name": p.name, "description": p.description,
                    "created_at": p.created_at, "updated_at": p.updated_at,
                    "default_branch": p.default_branch,
                    "file_count": p.file_count, "commit_count": p.commit_count,
                    "visibility": getattr(p, "visibility", "public"),
                    "tags": getattr(p, "tags", None) or [],
                    "readme": getattr(p, "readme", ""),
                    "commits": commits,
                    "files": files,
                    "assemblies": assemblies,
                }
        return None

    def create_project(self, name: str, description: str = "") -> dict:
        now = datetime.now().isoformat()
        project = G3DProject(
            id=str(uuid.uuid4())[:8],
            name=name,
            description=description,
            created_at=now,
            updated_at=now,
        )
        self._projects.append(project)
        self._save_projects()
        self._save_commits(project.id, [])
        os.makedirs(os.path.join(self._project_dir(project.id), "latest"), exist_ok=True)
        logger.info(f"G3D project created: {name} ({project.id})")
        return {
            "id": project.id, "name": project.name, "description": project.description,
            "created_at": project.created_at, "updated_at": project.updated_at,
            "default_branch": project.default_branch,
            "file_count": 0, "commit_count": 0,
        }

    def update_project(self, project_id: str, name: str = None, description: str = None) -> dict | None:
        for p in self._projects:
            if p.id == project_id:
                if name is not None:
                    p.name = name
                if description is not None:
                    p.description = description
                p.updated_at = datetime.now().isoformat()
                self._save_projects()
                return self.get_project(project_id)
        return None

    def delete_project(self, project_id: str) -> bool:
        for i, p in enumerate(self._projects):
            if p.id == project_id:
                del self._projects[i]
                self._save_projects()
                proj_dir = self._project_dir(project_id)
                if os.path.exists(proj_dir):
                    shutil.rmtree(proj_dir)
                logger.info(f"G3D project deleted: {project_id}")
                return True
        return False

    def _get_latest_files(self, project_id: str) -> list[dict]:
        latest_dir = os.path.join(self._project_dir(project_id), "latest")
        if not os.path.exists(latest_dir):
            return []
        files = []
        for fname in os.listdir(latest_dir):
            fpath = os.path.join(latest_dir, fname)
            if os.path.isfile(fpath):
                stat = os.stat(fpath)
                ext = os.path.splitext(fname)[1].lower()
                files.append({
                    "name": fname,
                    "size": stat.st_size,
                    "size_kb": round(stat.st_size / 1024, 1),
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "ext": ext,
                })
        files.sort(key=lambda x: x["name"])
        return files

    def get_commits(self, project_id: str) -> list[dict]:
        return self._load_commits(project_id)

    def upload_file(self, project_id: str, file_data, filename: str) -> dict:
        project = next((p for p in self._projects if p.id == project_id), None)
        if not project:
            return {"success": False, "message": "项目不存在"}
        staging_dir = os.path.join(self._project_dir(project_id), "staging")
        os.makedirs(staging_dir, exist_ok=True)
        safe_name = os.path.basename(filename)
        save_path = os.path.join(staging_dir, safe_name)
        file_data.save(save_path)
        size = os.path.getsize(save_path)
        project.updated_at = datetime.now().isoformat()
        self._save_projects()
        return {
            "success": True,
            "filename": safe_name,
            "size": size,
            "size_kb": round(size / 1024, 1),
            "message": f"文件已暂存: {safe_name}",
        }

    def commit(self, project_id: str, message: str, author: str = "") -> dict:
        project = next((p for p in self._projects if p.id == project_id), None)
        if not project:
            return {"success": False, "message": "项目不存在"}
        staging_dir = os.path.join(self._project_dir(project_id), "staging")
        if not os.path.exists(staging_dir) or not os.listdir(staging_dir):
            return {"success": False, "message": "暂存区为空，请先上传文件"}
        commit_id = str(uuid.uuid4())[:8]
        commit_dir = os.path.join(self._project_dir(project_id), commit_id)
        os.makedirs(commit_dir, exist_ok=True)
        latest_dir = os.path.join(self._project_dir(project_id), "latest")
        os.makedirs(latest_dir, exist_ok=True)
        staged_files = []
        for fname in os.listdir(staging_dir):
            fpath = os.path.join(staging_dir, fname)
            if os.path.isfile(fpath):
                shutil.copy2(fpath, os.path.join(commit_dir, fname))
                shutil.copy2(fpath, os.path.join(latest_dir, fname))
                staged_files.append(fname)
                os.remove(fpath)
        now = datetime.now().isoformat()
        commit_data = {
            "id": commit_id,
            "project_id": project_id,
            "message": message,
            "author": author or "XplorePrint",
            "timestamp": now,
            "file_count": len(staged_files),
            "files": staged_files,
        }
        commits = self._load_commits(project_id)
        commits.insert(0, commit_data)
        self._save_commits(project_id, commits)
        project.updated_at = now
        self._update_project_stats(project)
        self._save_projects()
        logger.info(f"G3D commit {commit_id} on {project.name}: {message} ({len(staged_files)} files)")
        return {"success": True, "commit": commit_data, "message": "提交成功"}

    def delete_commit(self, project_id: str, commit_id: str) -> dict:
        commits = self._load_commits(project_id)
        new_commits = [c for c in commits if c["id"] != commit_id]
        if len(new_commits) == len(commits):
            return {"success": False, "message": "提交不存在"}
        commit_dir = os.path.join(self._project_dir(project_id), commit_id)
        if os.path.exists(commit_dir):
            shutil.rmtree(commit_dir)
        self._save_commits(project_id, new_commits)
        project = next((p for p in self._projects if p.id == project_id), None)
        if project:
            project.updated_at = datetime.now().isoformat()
            self._update_project_stats(project)
            self._save_projects()
        return {"success": True, "message": "提交已删除"}

    def get_commit_files(self, project_id: str, commit_id: str) -> list[dict]:
        commit_dir = os.path.join(self._project_dir(project_id), commit_id)
        if not os.path.exists(commit_dir):
            return []
        files = []
        for fname in os.listdir(commit_dir):
            fpath = os.path.join(commit_dir, fname)
            if os.path.isfile(fpath):
                stat = os.stat(fpath)
                files.append({
                    "name": fname,
                    "size": stat.st_size,
                    "size_kb": round(stat.st_size / 1024, 1),
                    "ext": os.path.splitext(fname)[1].lower(),
                })
        return sorted(files, key=lambda x: x["name"])

    def download_file(self, project_id: str, filename: str, commit_id: str = None) -> str | None:
        if commit_id:
            fpath = os.path.join(self._project_dir(project_id), commit_id, filename)
        else:
            fpath = os.path.join(self._project_dir(project_id), "latest", filename)
        if os.path.exists(fpath) and os.path.isfile(fpath):
            return fpath
        return None

    def get_staging_files(self, project_id: str) -> list[dict]:
        staging_dir = os.path.join(self._project_dir(project_id), "staging")
        if not os.path.exists(staging_dir):
            return []
        files = []
        for fname in os.listdir(staging_dir):
            fpath = os.path.join(staging_dir, fname)
            if os.path.isfile(fpath):
                stat = os.stat(fpath)
                files.append({
                    "name": fname,
                    "size": stat.st_size,
                    "size_kb": round(stat.st_size / 1024, 1),
                    "ext": os.path.splitext(fname)[1].lower(),
                })
        return sorted(files, key=lambda x: x["name"])

    def clear_staging(self, project_id: str) -> dict:
        staging_dir = os.path.join(self._project_dir(project_id), "staging")
        count = 0
        if os.path.exists(staging_dir):
            for fname in os.listdir(staging_dir):
                fpath = os.path.join(staging_dir, fname)
                if os.path.isfile(fpath):
                    os.remove(fpath)
                    count += 1
        return {"success": True, "cleared": count, "message": f"已清除 {count} 个暂存文件"}

    def remove_staging_file(self, project_id: str, filename: str) -> dict:
        fpath = os.path.join(self._project_dir(project_id), "staging", os.path.basename(filename))
        if os.path.exists(fpath):
            os.remove(fpath)
            return {"success": True, "message": f"已移除暂存文件: {filename}"}
        return {"success": False, "message": "暂存文件不存在"}

    def delete_file(self, project_id: str, filename: str) -> dict:
        project = next((p for p in self._projects if p.id == project_id), None)
        if not project:
            return {"success": False, "message": "项目不存在"}
        fpath = os.path.join(self._project_dir(project_id), "latest", os.path.basename(filename))
        if not os.path.exists(fpath):
            return {"success": False, "message": "文件不存在"}
        os.remove(fpath)
        project.updated_at = datetime.now().isoformat()
        self._update_project_stats(project)
        self._save_projects()
        logger.info(f"G3D file deleted from {project.name}: {filename}")
        return {"success": True, "message": f"文件已删除: {filename}"}

    def update_readme(self, project_id: str, readme: str) -> dict:
        for p in self._projects:
            if p.id == project_id:
                p.readme = readme
                p.updated_at = datetime.now().isoformat()
                self._save_projects()
                return {"success": True, "message": "README 已更新"}
        return {"success": False, "message": "项目不存在"}

    def update_visibility(self, project_id: str, visibility: str) -> dict:
        if visibility not in ("public", "private"):
            return {"success": False, "message": "visibility 必须为 public 或 private"}
        for p in self._projects:
            if p.id == project_id:
                p.visibility = visibility
                p.updated_at = datetime.now().isoformat()
                self._save_projects()
                return {"success": True, "message": f"可见性已更新为 {visibility}"}
        return {"success": False, "message": "项目不存在"}

    def update_tags(self, project_id: str, tags: list) -> dict:
        for p in self._projects:
            if p.id == project_id:
                p.tags = tags
                p.updated_at = datetime.now().isoformat()
                self._save_projects()
                return {"success": True, "message": "标签已更新"}
        return {"success": False, "message": "项目不存在"}

    def _get_assemblies(self, project_id: str) -> list:
        assembly_file = os.path.join(self._project_dir(project_id), "assembly.json")
        if os.path.exists(assembly_file):
            try:
                with open(assembly_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    return data
                if isinstance(data, dict) and "assemblies" in data:
                    return data["assemblies"]
                if isinstance(data, dict) and "assembly_name" in data:
                    data["id"] = str(uuid.uuid4())[:8]
                    data["created_at"] = data.get("updated_at", datetime.now().isoformat())
                    return [data]
            except Exception:
                pass
        return []

    def _save_assemblies(self, project_id: str, assemblies: list):
        assembly_file = os.path.join(self._project_dir(project_id), "assembly.json")
        os.makedirs(self._project_dir(project_id), exist_ok=True)
        with open(assembly_file, "w", encoding="utf-8") as f:
            json.dump({"assemblies": assemblies}, f, indent=2, ensure_ascii=False)

    def add_assembly(self, project_id: str, data: dict) -> dict:
        project = next((p for p in self._projects if p.id == project_id), None)
        if not project:
            return {"success": False, "message": "项目不存在"}
        assemblies = self._get_assemblies(project_id)
        new_assembly = {
            "id": str(uuid.uuid4())[:8],
            "assembly_name": data.get("assembly_name", "").strip(),
            "parts": data.get("parts", []),
            "notes": data.get("notes", ""),
            "part_count": data.get("part_count", len(data.get("parts", []))),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        assemblies.append(new_assembly)
        self._save_assemblies(project_id, assemblies)
        project.updated_at = datetime.now().isoformat()
        self._save_projects()
        return {"success": True, "assembly": new_assembly, "assemblies": assemblies, "message": "装配体已添加"}

    def update_assembly(self, project_id: str, assembly_id: str, data: dict) -> dict:
        project = next((p for p in self._projects if p.id == project_id), None)
        if not project:
            return {"success": False, "message": "项目不存在"}
        assemblies = self._get_assemblies(project_id)
        for a in assemblies:
            if a["id"] == assembly_id:
                a["assembly_name"] = data.get("assembly_name", a["assembly_name"]).strip()
                a["parts"] = data.get("parts", a["parts"])
                a["notes"] = data.get("notes", a.get("notes", ""))
                a["part_count"] = data.get("part_count", len(a["parts"]))
                a["updated_at"] = datetime.now().isoformat()
                self._save_assemblies(project_id, assemblies)
                project.updated_at = datetime.now().isoformat()
                self._save_projects()
                return {"success": True, "assembly": a, "assemblies": assemblies, "message": "装配体已更新"}
        return {"success": False, "message": "装配体不存在"}

    def delete_assembly(self, project_id: str, assembly_id: str) -> dict:
        project = next((p for p in self._projects if p.id == project_id), None)
        if not project:
            return {"success": False, "message": "项目不存在"}
        assemblies = self._get_assemblies(project_id)
        before = len(assemblies)
        assemblies = [a for a in assemblies if a["id"] != assembly_id]
        if len(assemblies) == before:
            return {"success": False, "message": "装配体不存在"}
        self._save_assemblies(project_id, assemblies)
        project.updated_at = datetime.now().isoformat()
        self._save_projects()
        return {"success": True, "assemblies": assemblies, "message": "装配体已删除"}


g3d_manager = G3DManager()