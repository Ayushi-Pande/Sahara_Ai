from fastapi import HTTPException


def success(data):
    return {"success": True, "data": data}


def fail(status_code: int, message: str):
    raise HTTPException(status_code=status_code, detail={"success": False, "message": message})
