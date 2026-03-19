/** Hold reference to Socket.IO server for admin events (Golden Rain, Blackout). */
let _io = null
export function setIO(io) {
  _io = io
}
export function getIO() {
  return _io
}
