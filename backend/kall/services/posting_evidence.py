"""Stable visible organizational names from public ATS metadata."""

from kall.services.functional_areas import normalized_phrase


def visible_department_names(metadata: object) -> list[str]:
    """Extract department/team labels without IDs, ordering or bookkeeping.

    Lever and Ashby use strings; Greenhouse uses a list of named objects.
    Only explicit labels are evidence, never arbitrary dictionary values.
    Office names are location metadata and do not imply a functional area.
    """
    if not isinstance(metadata, dict):
        return []
    names: set[str] = set()
    for key in ("team", "department", "departments"):
        value = metadata.get(key)
        for item in value if isinstance(value, list) else [value]:
            label = item.get("name") if isinstance(item, dict) else item
            if isinstance(label, str):
                normalized = normalized_phrase(label)
                if normalized:
                    names.add(normalized)
    return sorted(names)
