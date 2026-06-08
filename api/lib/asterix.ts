export interface RadarTrack {
  icao24: string
  callsign: string
  lat: number
  lon: number
  altitude: number
  groundSpeed: number
  track: number
  verticalRate: number
  timestamp: number
}

const CAT021 = 0x15

function readFspec(buf: Buffer, offset: number): { bits: number[]; length: number } {
  const bits: number[] = []
  let pos = offset
  while (pos < buf.length) {
    const byte = buf[pos]
    for (let bit = 7; bit >= 0; bit--) {
      bits.push((byte >> bit) & 1)
    }
    pos++
    if ((byte & 0x01) === 0) break
  }
  return { bits, length: pos - offset }
}

function readInt8(buf: Buffer, offset: number): number {
  return buf.readInt8(offset)
}

function readUint8(buf: Buffer, offset: number): number {
  return buf.readUInt8(offset)
}

function readUint16(buf: Buffer, offset: number): number {
  return buf.readUInt16BE(offset)
}

function readInt16(buf: Buffer, offset: number): number {
  return buf.readInt16BE(offset)
}

function readUint24(buf: Buffer, offset: number): number {
  return (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2]
}

function readInt24(buf: Buffer, offset: number): number {
  const val = readUint24(buf, offset)
  return val > 0x7FFFFF ? val - 0x1000000 : val
}

function readUint32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset)
}

function readInt32(buf: Buffer, offset: number): number {
  return buf.readInt32BE(offset)
}

function decode6BitChars(buf: Buffer, offset: number, len: number): string {
  const chars: string[] = []
  const bits: number[] = []
  for (let i = 0; i < len; i++) {
    const byte = buf[offset + i]
    for (let b = 7; b >= 0; b--) {
      bits.push((byte >> b) & 1)
    }
  }
  for (let i = 0; i + 5 < bits.length; i += 6) {
    let val = 0
    for (let b = 0; b < 6; b++) {
      val = (val << 1) | bits[i + b]
    }
    if (val >= 1 && val <= 26) {
      chars.push(String.fromCharCode(64 + val))
    } else if (val >= 32 && val <= 57) {
      chars.push(String.fromCharCode(val))
    } else if (val === 0) {
      chars.push(' ')
    } else {
      chars.push(String.fromCharCode(val + 32))
    }
  }
  return chars.join('').trim()
}

function skipVariableField(buf: Buffer, offset: number): number {
  let pos = offset
  while (pos < buf.length) {
    const byte = buf[pos]
    pos++
    if ((byte & 0x01) === 0) break
  }
  return pos - offset
}

export function parseAsterixCat021(buffer: Buffer): RadarTrack[] {
  const tracks: RadarTrack[] = []
  let pos = 0

  while (pos < buffer.length - 2) {
    const cat = buffer[pos]
    if (cat !== CAT021) {
      pos++
      continue
    }

    if (pos + 3 > buffer.length) break
    const len = readUint16(buffer, pos + 1)
    if (len < 3 || pos + len > buffer.length) {
      pos++
      continue
    }

    const recordEnd = pos + len
    let offset = pos + 3

    const { bits: fspec, length: fspecLen } = readFspec(buffer, offset)
    offset += fspecLen

    let sac = 0
    let sic = 0
    let lat = 0
    let lon = 0
    let altitude = 0
    let icao24 = ''
    let callsign = ''
    let groundSpeed = 0
    let trackAngle = 0
    let verticalRate = 0
    let tod = 0

    for (let i = 0; i < fspec.length && offset < recordEnd; i++) {
      if (fspec[i] === 0) continue

      switch (i) {
        case 0:
          if (offset + 2 > recordEnd) break
          sac = readUint8(buffer, offset)
          sic = readUint8(buffer, offset + 1)
          offset += 2
          break

        case 1:
          offset += skipVariableField(buffer, offset)
          break

        case 2:
          if (offset + 2 > recordEnd) break
          offset += 2
          break

        case 3:
          if (offset + 1 > recordEnd) break
          offset += 1
          break

        case 4:
          if (offset + 3 > recordEnd) break
          tod = readUint24(buffer, offset) / 128.0
          offset += 3
          break

        case 5:
          if (offset + 6 > recordEnd) break
          lat = readInt24(buffer, offset) * 0.0001
          lon = readInt24(buffer, offset + 3) * 0.0001
          offset += 6
          break

        case 6:
          if (offset + 8 > recordEnd) break
          lat = readInt32(buffer, offset) * 0.0000001
          lon = readInt32(buffer, offset + 4) * 0.0000001
          offset += 8
          break

        case 7:
          if (offset + 2 > recordEnd) break
          altitude = readUint16(buffer, offset) * 0.25 * 100
          offset += 2
          break

        case 8:
          offset += skipVariableField(buffer, offset)
          break

        case 9:
          if (offset + 2 > recordEnd) break
          offset += 2
          break

        case 10:
          if (offset + 3 > recordEnd) break
          icao24 = buffer.slice(offset, offset + 3).toString('hex').toUpperCase()
          offset += 3
          break

        case 11:
          if (offset + 6 > recordEnd) break
          callsign = decode6BitChars(buffer, offset, 6)
          offset += 6
          break

        case 12:
          if (offset + 4 > recordEnd) break
          groundSpeed = readUint16(buffer, offset) * 0.25
          trackAngle = readUint16(buffer, offset + 2) * 0.0055
          offset += 4
          break

        case 13:
          if (offset + 2 > recordEnd) break
          offset += 2
          break

        case 14:
          if (offset + 2 > recordEnd) break
          verticalRate = readInt16(buffer, offset) * 6.25
          offset += 2
          break

        default:
          i = fspec.length
          break
      }
    }

    if (icao24 || callsign) {
      tracks.push({
        icao24: icao24 || `UNK${sac}${sic}`,
        callsign: callsign || 'N/A',
        lat,
        lon,
        altitude,
        groundSpeed,
        track: trackAngle,
        verticalRate,
        timestamp: Date.now(),
      })
    }

    pos = recordEnd
  }

  return tracks
}
