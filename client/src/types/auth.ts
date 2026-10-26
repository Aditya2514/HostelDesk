export type Role = "STUDENT" | "STAFF" | "WARDEN" | "CHIEF_WARDEN" | "ADMIN";
export type Trade = "ELECTRICIAN" | "PLUMBER" | "CARPENTER" | "NETWORK" | "HOUSEKEEPING";

export interface CurrentRoomInfo {
  roomId: string;
  roomNumber: string;
  floor: number;
  blockId: string;
  blockName: string;
  displayName: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  trade?: Trade | null;
  blockId?: string | null;
  blockName?: string | null;
  currentRoom?: CurrentRoomInfo | null;
}
