from fastapi import APIRouter, FastAPI
from pydantic import BaseModel
from typing import Optional


app = FastAPI()
users = APIRouter(prefix="/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    name: str
    email: Optional[str] = None


class UserCreate(BaseModel):
    name: str
    email: str


@users.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: int) -> UserOut:
    ...


@users.post("", response_model=UserOut)
async def create_user(payload: UserCreate) -> UserOut:
    ...


@users.get("")
async def list_users(limit: int = 50, offset: int = 0) -> list[UserOut]:
    ...


app.include_router(users, prefix="/api/v1")
