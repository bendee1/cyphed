export function rememberOverlayId(
  win: { webContents: { id: number }; on: (event: 'closed', listener: () => void) => unknown },
  overlays?: { add: (id: number) => void; remove: (id: number) => void }
): number {
  const id = win.webContents.id
  overlays?.add(id)
  win.on('closed', () => overlays?.remove(id))
  return id
}
