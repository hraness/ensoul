#!/usr/bin/env python3
"""Validate an Ensoul source packet without printing evidence content."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
from typing import NoReturn
from urllib.parse import urlsplit

from prepare_x_archive import ArchiveError, canonical_bytes, sha256_hex


MAX_PACKET_BYTES = 128 * 1024 * 1024
SAFE_INTEGER = 9_007_199_254_740_991
SHA256 = re.compile(r"^[a-f0-9]{64}$")
PREFIXED_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
DATE_TIME = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$"
)


class PacketValidationError(ValueError):
    pass


def fail(path: str, message: str) -> NoReturn:
    raise PacketValidationError(f"{path}: {message}")


def expect_dict(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        fail(path, "must be an object")
    return value


def expect_list(value: object, path: str) -> list[object]:
    if not isinstance(value, list):
        fail(path, "must be an array")
    return value


def expect_string(value: object, path: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        fail(path, "must be a string")
    if len(value) < minimum or len(value) > maximum:
        fail(path, "has an invalid length")
    return value


def expect_bool(value: object, path: str) -> bool:
    if not isinstance(value, bool):
        fail(path, "must be a boolean")
    return value


def exact_keys(
    value: dict[str, object],
    path: str,
    required: set[str],
    optional: set[str] = frozenset(),
) -> None:
    missing = required - value.keys()
    extra = value.keys() - required - optional
    if missing:
        fail(path, f"missing required member {sorted(missing)[0]}")
    if extra:
        fail(path, f"contains unknown member {sorted(extra)[0]}")


def expect_enum(value: object, path: str, allowed: set[str]) -> str:
    text = expect_string(value, path, 1, 200)
    if text not in allowed:
        fail(path, "has an unknown enum value")
    return text


def parse_datetime(value: object, path: str) -> dt.datetime:
    text = expect_string(value, path, 1, 100)
    if DATE_TIME.fullmatch(text) is None:
        fail(path, "must be an RFC 3339 date-time")
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        fail(path, "must be a valid date-time")
    if parsed.tzinfo is None:
        fail(path, "must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def expect_digest(value: object, path: str, prefixed: bool) -> str:
    text = expect_string(value, path, 64 if not prefixed else 71, 64 if not prefixed else 71)
    pattern = PREFIXED_SHA256 if prefixed else SHA256
    if pattern.fullmatch(text) is None:
        fail(path, "must be a lowercase SHA-256 digest")
    return text


def reject_non_ijson(value: object, path: str = "packet") -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        if abs(value) > SAFE_INTEGER:
            fail(path, "integer exceeds the interoperable JSON range")
        return
    if isinstance(value, float):
        fail(path, "floating-point values are not allowed by this packet schema")
    if isinstance(value, str):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            fail(path, "contains an unpaired Unicode surrogate")
        return
    if isinstance(value, list):
        for index, member in enumerate(value):
            reject_non_ijson(member, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, member in value.items():
            reject_non_ijson(key, f"{path}.key")
            reject_non_ijson(member, f"{path}.{key}")
        return
    fail(path, "contains a non-JSON value")


def strict_json_loads(data: bytes) -> object:
    if data.startswith(b"\xef\xbb\xbf"):
        fail("packet", "UTF-8 BOM is not allowed")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        fail("packet", "must be valid UTF-8")

    def object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                fail("packet", "contains a duplicate object member")
            result[key] = value
        return result

    def reject_constant(_: str) -> NoReturn:
        fail("packet", "contains a non-finite number")

    def reject_float(_: str) -> NoReturn:
        fail("packet", "floating-point numbers are not allowed")

    def parse_integer(value: str) -> int:
        parsed = int(value)
        if abs(parsed) > SAFE_INTEGER:
            fail("packet", "integer exceeds the interoperable JSON range")
        return parsed

    try:
        value = json.loads(
            text,
            object_pairs_hook=object_pairs,
            parse_constant=reject_constant,
            parse_float=reject_float,
            parse_int=parse_integer,
        )
    except json.JSONDecodeError:
        fail("packet", "is not valid JSON")
    reject_non_ijson(value)
    return value


def validate_subject(value: object) -> dict[str, object]:
    subject = expect_dict(value, "subject")
    exact_keys(subject, "subject", {"localId", "kind", "identityBasis"}, {"displayName"})
    expect_string(subject["localId"], "subject.localId", 1, 200)
    expect_enum(subject["kind"], "subject.kind", {"owner", "contact", "person"})
    expect_string(subject["identityBasis"], "subject.identityBasis", 1, 1000)
    if "displayName" in subject:
        expect_string(subject["displayName"], "subject.displayName", 1, 300)
    return subject


def validate_limits(value: object) -> dict[str, object]:
    limits = expect_dict(value, "scope.limits")
    if len(limits) > 24:
        fail("scope.limits", "has too many members")
    for key, member in limits.items():
        expect_string(key, "scope.limits key", 1, 200)
        if member is not None and not isinstance(member, (str, int, bool)):
            fail(f"scope.limits.{key}", "has a disallowed value type")
        reject_non_ijson(member, f"scope.limits.{key}")
    for name in ("after", "afterInclusive", "before", "beforeExclusive"):
        if name in limits and isinstance(limits[name], str):
            parse_datetime(limits[name], f"scope.limits.{name}")
    after_value = limits.get("after")
    before_value = limits.get("before")
    if isinstance(after_value, str) and isinstance(before_value, str):
        if parse_datetime(after_value, "scope.limits.after") >= parse_datetime(before_value, "scope.limits.before"):
            fail("scope.limits", "after must be earlier than before")
    return limits


def validate_scope(value: object) -> tuple[dict[str, object], dict[str, object]]:
    scope = expect_dict(value, "scope")
    exact_keys(
        scope,
        "scope",
        {"adapter", "payloadSchema", "completeness", "limits"},
        {"asOf", "sourceCutoff", "sourceRevision"},
    )
    expect_string(scope["adapter"], "scope.adapter", 1, 100)
    expect_string(scope["payloadSchema"], "scope.payloadSchema", 1, 160)
    expect_enum(scope["completeness"], "scope.completeness", {"complete", "sampled", "bounded", "unknown"})
    for key in ("asOf", "sourceCutoff"):
        if key in scope:
            parse_datetime(scope[key], f"scope.{key}")
    if "sourceRevision" in scope:
        expect_string(scope["sourceRevision"], "scope.sourceRevision", 1, 300)
    return scope, validate_limits(scope["limits"])


def validate_content(value: object, path: str) -> dict[str, object]:
    content = expect_dict(value, path)
    exact_keys(content, path, set(), {"text", "title", "url", "truncated"})
    if not any(key in content for key in ("text", "title", "url")):
        fail(path, "must include text, title, or url")
    if "text" in content:
        expect_string(content["text"], f"{path}.text", 0, 50_000)
    if "title" in content:
        expect_string(content["title"], f"{path}.title", 0, 1_000)
    if "url" in content:
        url = expect_string(content["url"], f"{path}.url", 1, 4_096)
        parsed = urlsplit(url)
        if not parsed.scheme or any(character.isspace() for character in url):
            fail(f"{path}.url", "must be an absolute URI")
    if "truncated" in content:
        expect_bool(content["truncated"], f"{path}.truncated")
    return content


def validate_provenance(value: object, path: str, content: dict[str, object]) -> None:
    provenance = expect_dict(value, path)
    exact_keys(
        provenance,
        path,
        {"provider", "contentSha256"},
        {"operation", "sourceId", "runId", "policyVersion", "model"},
    )
    expect_string(provenance["provider"], f"{path}.provider", 1, 100)
    for key in ("operation", "policyVersion", "model"):
        if key in provenance:
            expect_string(provenance[key], f"{path}.{key}", 1, 160)
    for key in ("sourceId", "runId"):
        if key in provenance:
            expect_string(provenance[key], f"{path}.{key}", 1, 300)
    digest = expect_digest(provenance["contentSha256"], f"{path}.contentSha256", False)
    try:
        expected = sha256_hex(canonical_bytes(content))
    except ArchiveError as exc:
        fail(path, str(exc))
    if digest != expected:
        fail(path, "content digest mismatch")


def validate_record(value: object, index: int) -> tuple[dict[str, object], dt.datetime | None]:
    path = f"records[{index}]"
    record = expect_dict(value, path)
    required = {
        "id", "digest", "kind", "authorRole", "contentRole", "authorshipConfidence",
        "sentStatus", "visibility", "sourceClass", "content", "provenance",
    }
    exact_keys(record, path, required, {"occurredAt", "observedAt"})
    if "occurredAt" not in record and "observedAt" not in record:
        fail(path, "must include occurredAt or observedAt")
    expect_string(record["id"], f"{path}.id", 1, 200)
    digest = expect_digest(record["digest"], f"{path}.digest", True)
    expect_string(record["kind"], f"{path}.kind", 1, 100)
    expect_enum(record["authorRole"], f"{path}.authorRole", {"subject", "counterpart", "third_party", "mixed", "unknown"})
    expect_enum(record["contentRole"], f"{path}.contentRole", {"original", "quoted", "forwarded", "summary", "ai_assisted", "mixed", "unknown"})
    expect_enum(record["authorshipConfidence"], f"{path}.authorshipConfidence", {"verified", "strong", "weak", "unknown"})
    expect_enum(record["sentStatus"], f"{path}.sentStatus", {"sent", "draft", "received", "published", "unknown"})
    expect_enum(record["visibility"], f"{path}.visibility", {"public", "private"})
    expect_enum(record["sourceClass"], f"{path}.sourceClass", {
        "private_capture", "polished_self_presentation", "observed_behavior", "public_web_evidence",
        "third_party_description", "institutional", "metadata",
    })
    occurred = parse_datetime(record["occurredAt"], f"{path}.occurredAt") if "occurredAt" in record else None
    if "observedAt" in record:
        parse_datetime(record["observedAt"], f"{path}.observedAt")
    content = validate_content(record["content"], f"{path}.content")
    validate_provenance(record["provenance"], f"{path}.provenance", content)
    without_digest = dict(record)
    without_digest.pop("digest")
    try:
        expected = "sha256:" + sha256_hex(canonical_bytes(without_digest))
    except ArchiveError as exc:
        fail(path, str(exc))
    if digest != expected:
        fail(path, "record digest mismatch")
    return record, occurred


def validate_claims(
    value: object,
    subject_local_id: str,
    record_ids: set[str],
) -> int:
    claims = expect_list(value, "claims")
    if len(claims) > 500:
        fail("claims", "has too many items")
    claim_ids: set[str] = set()
    required = {
        "id", "text", "recordIds", "status", "claimantRole", "claimKind",
        "subjectLocalId", "sensitivity",
    }
    for index, raw in enumerate(claims):
        path = f"claims[{index}]"
        claim = expect_dict(raw, path)
        exact_keys(claim, path, required)
        claim_id = expect_string(claim["id"], f"{path}.id", 1, 200)
        if claim_id in claim_ids:
            fail(path, "duplicates another claim id")
        claim_ids.add(claim_id)
        expect_string(claim["text"], f"{path}.text", 1, 4_000)
        refs = expect_list(claim["recordIds"], f"{path}.recordIds")
        if len(refs) < 1 or len(refs) > 50:
            fail(f"{path}.recordIds", "has an invalid item count")
        normalized_refs: list[str] = []
        for ref_index, ref in enumerate(refs):
            normalized_refs.append(expect_string(ref, f"{path}.recordIds[{ref_index}]", 1, 200))
        if len(set(normalized_refs)) != len(normalized_refs):
            fail(f"{path}.recordIds", "contains duplicates")
        if any(ref not in record_ids for ref in normalized_refs):
            fail(f"{path}.recordIds", "references an unknown record")
        expect_enum(claim["status"], f"{path}.status", {"source_reported", "adapter_structured", "contested"})
        expect_enum(claim["claimantRole"], f"{path}.claimantRole", {"subject", "counterpart", "third_party", "institutional", "adapter", "unknown"})
        expect_enum(claim["claimKind"], f"{path}.claimKind", {"fact", "stated_belief", "reported_observation", "derived_index"})
        if expect_string(claim["subjectLocalId"], f"{path}.subjectLocalId", 1, 200) != subject_local_id:
            fail(f"{path}.subjectLocalId", "does not match packet subject")
        expect_enum(claim["sensitivity"], f"{path}.sensitivity", {"ordinary", "sensitive_explicit"})
    return len(claims)


def validate_packet(value: object) -> dict[str, object]:
    packet = expect_dict(value, "packet")
    required = {
        "schemaVersion", "digestCanonicalization", "packetId", "generatedAt", "subject",
        "scope", "records", "limitations", "packetDigest",
    }
    exact_keys(packet, "packet", required, {"claims"})
    if packet["schemaVersion"] != "ensoul.source-packet.v1":
        fail("schemaVersion", "unsupported schema")
    if packet["digestCanonicalization"] != "JCS-RFC8785":
        fail("digestCanonicalization", "unsupported digest canonicalization")
    expect_string(packet["packetId"], "packetId", 8, 160)
    parse_datetime(packet["generatedAt"], "generatedAt")
    subject = validate_subject(packet["subject"])
    scope, limits = validate_scope(packet["scope"])
    records = expect_list(packet["records"], "records")
    if len(records) > 2_000:
        fail("records", "has too many items")
    record_ids: set[str] = set()
    occurred_values: list[dt.datetime] = []
    for index, raw in enumerate(records):
        record, occurred = validate_record(raw, index)
        record_id = str(record["id"])
        if record_id in record_ids:
            fail(f"records[{index}].id", "duplicates another record id")
        record_ids.add(record_id)
        if occurred is not None:
            occurred_values.append(occurred)
    after_raw = limits.get("after")
    if not isinstance(after_raw, str) and isinstance(limits.get("afterInclusive"), str):
        after_raw = limits.get("afterInclusive")
    before_raw = limits.get("before")
    if not isinstance(before_raw, str) and isinstance(limits.get("beforeExclusive"), str):
        before_raw = limits.get("beforeExclusive")
    if isinstance(after_raw, str):
        after = parse_datetime(after_raw, "scope.limits.after")
        if any(value < after for value in occurred_values):
            fail("records", "contains an occurredAt before the declared lower bound")
    if isinstance(before_raw, str):
        before = parse_datetime(before_raw, "scope.limits.before")
        if any(value >= before for value in occurred_values):
            fail("records", "contains an occurredAt at or after the declared upper bound")
    limitations = expect_list(packet["limitations"], "limitations")
    if len(limitations) < 1 or len(limitations) > 32:
        fail("limitations", "has an invalid item count")
    for index, limitation in enumerate(limitations):
        expect_string(limitation, f"limitations[{index}]", 1, 1_000)
    claim_count = validate_claims(packet.get("claims", []), str(subject["localId"]), record_ids)
    digest = expect_digest(packet["packetDigest"], "packetDigest", True)
    without_digest = dict(packet)
    without_digest.pop("packetDigest")
    try:
        expected = "sha256:" + sha256_hex(canonical_bytes(without_digest))
    except ArchiveError as exc:
        fail("packet", str(exc))
    if digest != expected:
        fail("packetDigest", "packet digest mismatch")
    visibility_counts = {"private": 0, "public": 0}
    for record in records:
        visibility_counts[str(record["visibility"])] += 1  # type: ignore[index]
    return {
        "valid": True,
        "schemaVersion": packet["schemaVersion"],
        "packetDigest": digest,
        "adapter": scope["adapter"],
        "payloadSchema": scope["payloadSchema"],
        "records": len(records),
        "claims": claim_count,
        "visibility": visibility_counts,
    }


def validate_file(path: Path) -> dict[str, object]:
    if not path.is_absolute():
        fail("input", "path must be absolute")
    if path.is_symlink() or not path.is_file():
        fail("input", "must be a regular non-symlink file")
    size = os.stat(path, follow_symlinks=False).st_size
    if size > MAX_PACKET_BYTES:
        fail("input", "packet exceeds the size limit")
    return validate_packet(strict_json_loads(path.read_bytes()))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet", type=Path, help="absolute path to one Ensoul packet")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    try:
        receipt = validate_file(args.packet)
        print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
        return 0
    except (PacketValidationError, OSError) as exc:
        print(f"invalid Ensoul source packet: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
