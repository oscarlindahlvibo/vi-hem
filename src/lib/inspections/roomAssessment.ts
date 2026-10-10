export type RoomAssessment = { condition?: string; condition_selected?: boolean; reviewed?: boolean };
// Missing workflow metadata belongs to historical rows, not a newly selected default.
export function hasRoomAssessment(room: RoomAssessment) {
  return room.condition_selected ?? (room.reviewed === undefined || room.reviewed === true || Boolean(room.condition && room.condition !== 'good'));
}
