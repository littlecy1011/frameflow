import tempfile
import unittest
import json
from pathlib import Path
from unittest.mock import patch

import app


class MarkdownTests(unittest.TestCase):
    def test_parse_markdown(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "candidate.md"
            path.write_text(
                "---\ndecision: pending\nsource: \"https://example.com/a\"\n---\n\n# 测试候选\n正文",
                encoding="utf-8",
            )
            meta, body, title = app.parse_markdown(path)
            self.assertEqual(meta["decision"], "pending")
            self.assertEqual(meta["source"], "https://example.com/a")
            self.assertEqual(title, "测试候选")
            self.assertIn("正文", body)

    def test_update_frontmatter_preserves_body(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "candidate.md"
            path.write_text("---\ndecision: pending\n---\n\n# 标题\n原始正文", encoding="utf-8")
            app.update_frontmatter(path, {"decision": "approved", "codex_status": "pending"})
            text = path.read_text(encoding="utf-8")
            self.assertIn("decision: approved", text)
            self.assertIn("codex_status: pending", text)
            self.assertIn("原始正文", text)

    def test_safe_slug(self):
        self.assertEqual(app.safe_slug('A/B: "测试"'), "A-B-测试")

    def test_candidate_metadata_falls_back_to_body(self):
        body = """# 测试候选

- 原始链接：https://www.instagram.com/reel/example/
- 平台：instagram
- 作者：@creator
- 发布日期：2026-10-23
- 采集日期：2026-10-27
- 互动数据采集时间：2026-10-27 14:59 Asia/Shanghai
"""
        result = app.candidate_metadata({"decision": "pending"}, body)
        self.assertEqual(result["source_platform"], "instagram")
        self.assertEqual(result["source_creator"], "@creator")
        self.assertEqual(result["source_published_at"], "2026-10-23")
        self.assertEqual(result["captured_at"], "2026-10-27")
        self.assertEqual(result["metrics_snapshot_at"], "2026-10-27 14:59 Asia/Shanghai")

    def test_engagement_metrics_from_combined_snapshot(self):
        result = app.engagement_metrics("- 可见互动数据：6.1K 点赞、150 评论")
        self.assertEqual(result["likes"], "6.1K")
        self.assertEqual(result["comments"], "150")

    def test_engagement_metrics_keep_unknown(self):
        result = app.engagement_metrics("- 点赞：未知\n- 评论：未知")
        self.assertEqual(result["likes"], "未知")
        self.assertEqual(result["comments"], "未知")

    def test_project_file_from_link_accepts_project_file(self):
        project = app.PROJECTS_DIR / "测试项目" / "制作包.md"
        project.parent.mkdir(parents=True, exist_ok=True)
        project.write_text("# 测试制作包", encoding="utf-8")
        try:
            link = "[[The wiki/Projects/AI视频工作台/制作项目/测试项目/制作包|测试制作包]]"
            self.assertEqual(app.project_file_from_link(link), project.resolve())
        finally:
            project.unlink()
            project.parent.rmdir()

    def test_project_file_from_link_rejects_outside_project_directory(self):
        link = "[[context 说明文件|越界文件]]"
        self.assertIsNone(app.project_file_from_link(link))

    def test_analysis_schema_requires_hypit_directing_sections(self):
        schema = json.loads(app.SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertIn("hypit_brief", schema["required"])
        self.assertIn("hypit_treatment", schema["required"])
        prompt_required = schema["properties"]["prompt_pack"]["items"]["required"]
        self.assertIn("generation_relationship", prompt_required)
        self.assertIn("expressive_intent", prompt_required)

    def test_analysis_prompt_requires_directing_method_and_boundaries(self):
        prompt = app.analysis_prompt({"path": "/tmp/candidate.md"})
        self.assertIn("Brief", prompt)
        self.assertIn("Treatment", prompt)
        self.assertIn("不创建 Build", prompt)

    def test_production_readiness_does_not_claim_runtime_or_quote(self):
        result = app.production_readiness({"project_link": ""})
        self.assertIn(result["method"], {"hypit-guided", "director-guided"})
        self.assertFalse(result["runtime_connected"])
        self.assertFalse(result["provider_connected"])
        self.assertFalse(result["quote_available"])
        self.assertFalse(result["can_generate"])

    def test_handoff_plan_defaults_to_image_plus_prompt_without_motion_reference(self):
        candidate = {"source_url": "https://example.com/reference"}
        result = {
            "hypit_treatment": {"premise": "原创故事", "performance_direction": "自然表演", "visual_world": "夜景"},
            "script": [{"visual": "双人全身构图"}],
            "prompt_pack": [{
                "generation_relationship": "text-directed",
                "input_responsibilities": ["文本定义动作"],
                "prompt": "视频提示词",
                "negative_prompt": "不要水印",
            }],
        }
        handoff = app.build_handoff_plan(candidate, result)
        self.assertEqual(handoff["recommended_mode"], "定妆照 + 提示词")
        self.assertFalse(handoff["reference_video_required"])
        self.assertTrue(handoff["image_required"])
        self.assertEqual(handoff["video_prompt_count"], 1)


if __name__ == "__main__":
    unittest.main()

