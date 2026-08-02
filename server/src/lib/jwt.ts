import jwt from 'jsonwebtoken'
import { config } from 'dotenv'

config()

const SECRET = process.env.JWT_SECRET!

export interface JwtPayload {
  id: number
  username: string
  name: string
  role: 'admin' | 'vendor'
  empresaId: number
  superAdmin: boolean
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, SECRET) as JwtPayload
  } catch {
    return null
  }
}
