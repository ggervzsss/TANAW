"""Deterministic PDF rendering from immutable final-report snapshots only."""

from __future__ import annotations

import json
import textwrap
from collections.abc import Mapping
from dataclasses import dataclass

TEMPLATE_VERSION = "official-final-report-v1"
_PAGE_LINE_LIMIT = 66
_DISPLAY_WIDTH = 92


class ArtifactRenderError(RuntimeError):
    """The immutable snapshot cannot be rendered by the supported template."""


@dataclass(frozen=True, slots=True)
class ArtifactRenderSnapshot:
    artifact_id: str
    template_version: str
    report_code: str
    version_content_hash: str
    document: Mapping[str, object]


def render_final_report_pdf(snapshot: ArtifactRenderSnapshot) -> bytes:
    """Render one byte-stable PDF without consulting mutable runtime data.

    The body is canonical, reversible JSON. Non-ASCII code points are displayed
    as JSON ``\\u`` escapes so no identity text is silently replaced or dropped
    by the PDF's built-in ASCII font.
    """

    if snapshot.template_version != TEMPLATE_VERSION:
        raise ArtifactRenderError("Unsupported final-report artifact template.")
    pretty_json = json.dumps(
        snapshot.document,
        ensure_ascii=True,
        indent=2,
        sort_keys=True,
        separators=(",", ": "),
    )
    lines = [
        "TANAW OFFICIAL FINAL REPORT",
        f"Report code: {snapshot.report_code}",
        f"Artifact ID: {snapshot.artifact_id}",
        f"Template: {snapshot.template_version}",
        f"Immutable version content hash: {snapshot.version_content_hash}",
        "The JSON below is rendered only from frozen final-version facts and audit events.",
        "",
    ]
    for line in pretty_json.splitlines():
        lines.extend(
            textwrap.wrap(
                line,
                width=_DISPLAY_WIDTH,
                replace_whitespace=False,
                drop_whitespace=False,
                break_long_words=True,
                break_on_hyphens=False,
            )
            or [""]
        )
    pages = [
        lines[index : index + _PAGE_LINE_LIMIT] for index in range(0, len(lines), _PAGE_LINE_LIMIT)
    ]
    if not pages:
        raise ArtifactRenderError("Final-report snapshot produced no document content.")
    return _serialize_pdf(pages)


def _serialize_pdf(pages: list[list[str]]) -> bytes:
    page_object_ids = [4 + index * 2 for index in range(len(pages))]
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        (
            f"<< /Type /Pages /Kids [{' '.join(f'{item} 0 R' for item in page_object_ids)}] "
            f"/Count {len(pages)} >>"
        ).encode("ascii"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
    ]
    for index, lines in enumerate(pages):
        page_id = page_object_ids[index]
        content_id = page_id + 1
        objects.append(
            (
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                "/Resources << /Font << /F1 3 0 R >> >> "
                f"/Contents {content_id} 0 R >>"
            ).encode("ascii")
        )
        commands = [b"BT", b"/F1 8 Tf", b"36 756 Td", b"10 TL"]
        for line in lines:
            encoded = _pdf_literal(line).encode("ascii")
            commands.append(b"(" + encoded + b") Tj")
            commands.append(b"T*")
        commands.append(b"ET")
        stream = b"\n".join(commands) + b"\n"
        objects.append(
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"endstream"
        )

    output = bytearray(b"%PDF-1.4\n%TANAW\n")
    offsets = [0]
    for object_id, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{object_id} 0 obj\n".encode("ascii"))
        output.extend(body)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(output)


def _pdf_literal(value: str) -> str:
    if not value.isascii():
        raise ArtifactRenderError("PDF display input must be canonical ASCII text.")
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
