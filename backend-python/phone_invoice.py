"""
HermesWork Phone Invoice Module
Stores client phone numbers and auto-sends invoice payment links via WhatsApp.
Imported by app.py startup.
"""

def normalize_phone(phone: str) -> str:
    """Normalize a phone number to WhatsApp format.
    Accepts: +919876543210, 919876543210, 09876543210
    Returns: whatsapp:+919876543210
    """
    if not phone:
        return ""
    p = phone.strip()
    # Already in whatsapp: format
    if p.startswith("whatsapp:"):
        return p
    # Remove spaces, dashes, parens
    import re
    p = re.sub(r"[\s\-\(\)]", "", p)
    # Ensure starts with +
    if not p.startswith("+"):
        p = "+" + p
    return "whatsapp:" + p


def get_client_phone(db: dict, client_name: str) -> str:
    """
    Look up a client's phone number by name (case-insensitive).
    Returns the normalized WhatsApp number or empty string.
    """
    if not client_name:
        return ""
    name_lower = client_name.lower().strip()
    for c in db.get("clients", []):
        if (
            str(c.get("name", "")).lower() == name_lower
            or str(c.get("company", "")).lower() == name_lower
        ):
            phone = c.get("phone", "")
            if phone:
                return normalize_phone(phone)
    return ""
