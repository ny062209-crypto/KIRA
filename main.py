"""
KIRA Auto Post - Telegram Telethon Backend Engine
Created by KIRA Gaming
"""

import os
import asyncio
import base64
from typing import Optional, List
from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    SessionPasswordNeededError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    PhoneNumberInvalidError,
    PhoneNumberBannedError,
    FloodWaitError,
    ChatWriteForbiddenError,
    ApiIdInvalidError
)

app = FastAPI(title="KIRA Auto Post Engine", version="1.1.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECURITY_TOKEN = os.getenv("KIRA_SECURITY_TOKEN", "kira-secret-token")

# Temporary in-memory pending client sessions during phone code verification
# phone -> {"client": TelegramClient, "phone_code_hash": str}
pending_logins = {}

# Cached, connected clients keyed by session string (v1.1.2).
# A fresh StringSession has no entity cache, so sending/forwarding to a group by
# numeric id fails with "Could not find the input entity". We warm the cache once
# with get_dialogs() and keep the client connected for the following posts.
live_clients = {}
client_lock = asyncio.Lock()

async def get_live_client(session_string: str) -> TelegramClient:
    key = session_string.strip()
    async with client_lock:
        client = live_clients.get(key)
        if client is not None and client.is_connected():
            return client
        client = TelegramClient(StringSession(key), 6, "eb06d4abfb49dc3eeb1aeb9890c48e85")
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            raise HTTPException(status_code=401, detail="Telegram session is no longer valid")
        await client.get_dialogs(limit=500)
        live_clients[key] = client
        return client

async def verify_token(x_kira_token: Optional[str] = Header(None)):
    if SECURITY_TOKEN and x_kira_token != SECURITY_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid X-Kira-Token security token")
    return True

class SendCodeRequest(BaseModel):
    api_id: int
    api_hash: str
    phone: str

class VerifyCodeRequest(BaseModel):
    phone: str
    phone_code_hash: str
    code: str

class Verify2FaRequest(BaseModel):
    phone: str
    password: str

class LoadChatsRequest(BaseModel):
    session_string: str

@app.get("/health")
async def health_check():
    return {"status": "ok", "engine": "telethon", "app": "KIRA Auto Post"}

@app.post("/login/send-code", dependencies=[Depends(verify_token)])
async def send_code(req: SendCodeRequest):
    phone = req.phone.strip()
    session = StringSession()
    client = TelegramClient(session, req.api_id, req.api_hash)
    await client.connect()

    try:
        sent_code = await client.send_code_request(phone)
        pending_logins[phone] = {
            "client": client,
            "api_id": req.api_id,
            "api_hash": req.api_hash,
            "phone_code_hash": sent_code.phone_code_hash
        }
        delivery = "Telegram App"
        if getattr(sent_code.type, "__name__", "") == "SentCodeTypeSms":
            delivery = "SMS"

        return {
            "status": "ok",
            "phone_code_hash": sent_code.phone_code_hash,
            "delivery_type": delivery,
            "timeout": sent_code.timeout or 60
        }
    except ApiIdInvalidError:
        await client.disconnect()
        return {"status": "error", "error_code": "API_ID_INVALID", "error": "API ID or API Hash is invalid"}
    except PhoneNumberInvalidError:
        await client.disconnect()
        return {"status": "error", "error_code": "PHONE_NUMBER_INVALID", "error": "Invalid phone number format"}
    except PhoneNumberBannedError:
        await client.disconnect()
        return {"status": "error", "error_code": "PHONE_NUMBER_BANNED", "error": "This phone number has been banned by Telegram"}
    except FloodWaitError as e:
        await client.disconnect()
        return {"status": "error", "error_code": f"FLOOD_WAIT_{e.seconds}", "error": f"Must wait {e.seconds} seconds"}
    except Exception as e:
        await client.disconnect()
        return {"status": "error", "error_code": "UNKNOWN", "error": str(e)}

@app.post("/login/verify", dependencies=[Depends(verify_token)])
async def verify_code(req: VerifyCodeRequest):
    phone = req.phone.strip()
    pending = pending_logins.get(phone)
    if not pending:
        return {"status": "error", "error_code": "SESSION_EXPIRED", "error": "No pending login found for this phone. Please request code again."}

    client: TelegramClient = pending["client"]
    try:
        user = await client.sign_in(phone=phone, code=req.code.strip(), phone_code_hash=req.phone_code_hash)
        session_str = client.session.save()
        await client.disconnect()
        del pending_logins[phone]

        return {
            "status": "ok",
            "user_id": user.id,
            "first_name": user.first_name or "",
            "username": user.username or "",
            "session_string": session_str
        }
    except SessionPasswordNeededError:
        return {"status": "2fa_required", "error_code": "SESSION_PASSWORD_NEEDED", "error": "Two-step verification (2FA) password needed"}
    except PhoneCodeInvalidError:
        return {"status": "error", "error_code": "PHONE_CODE_INVALID", "error": "Invalid verification code"}
    except PhoneCodeExpiredError:
        return {"status": "error", "error_code": "PHONE_CODE_EXPIRED", "error": "Verification code has expired"}
    except Exception as e:
        return {"status": "error", "error_code": "VERIFY_ERROR", "error": str(e)}

@app.post("/login/2fa", dependencies=[Depends(verify_token)])
async def verify_2fa(req: Verify2FaRequest):
    phone = req.phone.strip()
    pending = pending_logins.get(phone)
    if not pending:
        return {"status": "error", "error_code": "SESSION_EXPIRED", "error": "No pending login found"}

    client: TelegramClient = pending["client"]
    try:
        user = await client.sign_in(password=req.password)
        session_str = client.session.save()
        await client.disconnect()
        del pending_logins[phone]

        return {
            "status": "ok",
            "user_id": user.id,
            "first_name": user.first_name or "",
            "username": user.username or "",
            "session_string": session_str
        }
    except Exception as e:
        return {"status": "error", "error_code": "PASSWORD_HASH_INVALID", "error": str(e)}

@app.post("/chats", dependencies=[Depends(verify_token)])
async def load_chats(req: LoadChatsRequest):
    session = StringSession(req.session_string.strip())
    # api_id 6, "eb06d4abfb49dc3eeb1aeb9890c48e85" are standard official client credentials for session resuming
    client = TelegramClient(session, 6, "eb06d4abfb49dc3eeb1aeb9890c48e85")
    await client.connect()

    try:
        dialogs = await client.get_dialogs(limit=300)
        sem = asyncio.Semaphore(8)

        async def fetch_photo(entity):
            # Small thumbnail of the group/channel profile photo (base64 JPEG)
            async with sem:
                try:
                    data = await asyncio.wait_for(
                        client.download_profile_photo(entity, file=bytes, download_big=False),
                        timeout=15
                    )
                    if data:
                        return base64.b64encode(data).decode("ascii")
                except Exception:
                    pass
            return ""

        selected = [d for d in dialogs if d.is_group or d.is_channel]
        photos = await asyncio.gather(*[fetch_photo(d.entity) for d in selected])

        chat_list = []
        for d, photo in zip(selected, photos):
            entity = d.entity
            chat_type = "group"
            if getattr(entity, "broadcast", False):
                chat_type = "channel"
            elif getattr(entity, "megagroup", False):
                chat_type = "supergroup"

            can_post = True
            if getattr(entity, "restricted", False):
                can_post = False
            if getattr(entity, "broadcast", False) and not getattr(entity, "creator", False) and not getattr(entity, "admin_rights", None):
                can_post = False

            members = getattr(entity, "participants_count", 0) or 0

            chat_list.append({
                "id": d.id,
                "title": d.title,
                "username": getattr(entity, "username", None) or "",
                "type": chat_type,
                "can_post": can_post,
                "member_count": members,
                "photo": photo
            })

        await client.disconnect()
        return {"status": "ok", "chats": chat_list}
    except Exception as e:
        await client.disconnect()
        return {"status": "error", "error_code": "CHATS_ERROR", "error": str(e)}

def _flood(e):
    return {"status": "error", "error_code": f"FLOOD_WAIT_{e.seconds}", "error": f"Flood wait {e.seconds}s"}

@app.post("/send", dependencies=[Depends(verify_token)])
async def send_message(
    session_string: str = Form(...),
    chat_id: int = Form(...),
    text: str = Form(""),
    media: List[UploadFile] = File(default=[])
):
    """Stage 1: post the content once (normally into Saved Messages, chat_id=0)."""
    temp_files = []
    try:
        client = await get_live_client(session_string)
        target = "me" if chat_id == 0 else chat_id

        if media:
            for m in media:
                path = f"/tmp/{os.urandom(4).hex()}_{os.path.basename(m.filename or 'file')}"
                with open(path, "wb") as f:
                    f.write(await m.read())
                temp_files.append(path)
            files = temp_files[0] if len(temp_files) == 1 else temp_files
            sent = await client.send_file(target, files, caption=text)
        else:
            sent = await client.send_message(target, text)

        msgs = sent if isinstance(sent, list) else [sent]
        ids = [getattr(m, "id", 0) for m in msgs]
        return {"status": "ok", "message_id": ids[0] if ids else 0, "message_ids": ids}
    except HTTPException:
        raise
    except ChatWriteForbiddenError:
        return {"status": "error", "error_code": "CHAT_WRITE_FORBIDDEN", "error": "You do not have permission to post in this group"}
    except FloodWaitError as e:
        return _flood(e)
    except Exception as e:
        return {"status": "error", "error_code": "SEND_ERROR", "error": str(e)}
    finally:
        for p in temp_files:
            if os.path.exists(p):
                os.remove(p)

class ForwardRequest(BaseModel):
    session_string: str
    to_chat_id: int
    message_ids: List[int]
    from_chat_id: int = 0          # 0 = Saved Messages
    hide_author: bool = True       # forward without the "Forwarded from" header

@app.post("/forward", dependencies=[Depends(verify_token)])
async def forward_messages(req: ForwardRequest):
    """Stage 2: forward the Saved Messages post to one selected group/channel."""
    try:
        client = await get_live_client(req.session_string)
        source = "me" if req.from_chat_id == 0 else req.from_chat_id
        sent = await client.forward_messages(
            req.to_chat_id,
            req.message_ids,
            from_peer=source,
            drop_author=req.hide_author,
        )
        msgs = sent if isinstance(sent, list) else [sent]
        return {"status": "ok", "message_id": getattr(msgs[0], "id", 0) if msgs else 0,
                "message_ids": [getattr(m, "id", 0) for m in msgs]}
    except HTTPException:
        raise
    except ChatWriteForbiddenError:
        return {"status": "error", "error_code": "CHAT_WRITE_FORBIDDEN", "error": "You do not have permission to post in this group"}
    except FloodWaitError as e:
        return _flood(e)
    except Exception as e:
        return {"status": "error", "error_code": "FORWARD_ERROR", "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
