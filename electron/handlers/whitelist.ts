import { ipcMain, app } from 'electron'
import type { Account } from 'eml-lib'
import logger from 'electron-log/main'
import fs from 'node:fs'
import path from 'node:path'
import { API_URL } from '../const'

const sessionPath = path.join(app.getPath('userData'), 'session.json')
const cachePath = path.join(app.getPath('userData'), 'whitelist.json')

const WHITELIST_URL = `${API_URL}/f42/whitelist`
const REQUEST_URL = `${API_URL}/f42/whitelist/request`
const REQUEST_TIMEOUT = 10_000

export type WhitelistState = 'whitelisted' | 'partial' | 'none' | 'pending' | 'unknown'

export interface IWhitelistService {
  name: string
  exists: boolean
  error: string | null
  whitelisted: boolean
  entry: { uuid: string; name: string } | null
}

export interface IWhitelistStatus {
  player: string
  services: IWhitelistService[]
  checkedServices: string[]
  whitelistedEverywhere: boolean
}

export interface IWhitelistResponse {
  state: WhitelistState
  status: IWhitelistStatus | null
  requestedAt: string | null
  missingServices: string[]
}

export interface IWhitelistRequestResponse {
  ok: boolean
  already?: boolean
  note?: string
  retryAfter?: number
  error?: string
}

interface IWhitelistCache {
  name: string | null
  requestedAt: string | null
  lastChecked: string | null
}

const EMPTY_CACHE: IWhitelistCache = { name: null, requestedAt: null, lastChecked: null }

function readCache(): IWhitelistCache {
  try {
    if (!fs.existsSync(cachePath)) return { ...EMPTY_CACHE }
    return { ...EMPTY_CACHE, ...JSON.parse(fs.readFileSync(cachePath, 'utf-8')) }
  } catch (err) {
    logger.error('Error reading whitelist cache:', err)
    return { ...EMPTY_CACHE }
  }
}

function writeCache(cache: IWhitelistCache): void {
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  } catch (err) {
    logger.error('Error writing whitelist cache:', err)
  }
}

function readPlayerName(): string | null {
  try {
    if (!fs.existsSync(sessionPath)) return null
    const account = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as Account
    return account?.name ?? null
  } catch (err) {
    logger.error('Error reading session for whitelist:', err)
    return null
  }
}

function readStatus(payload: unknown): IWhitelistStatus | null {
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Partial<IWhitelistStatus>
  if (!Array.isArray(record.services)) return null

  return {
    player: record.player ?? '',
    services: record.services,
    checkedServices: Array.isArray(record.checkedServices) ? record.checkedServices : [],
    whitelistedEverywhere: record.whitelistedEverywhere === true
  }
}

function resolveState(status: IWhitelistStatus, hasRequest: boolean): { state: WhitelistState; missingServices: string[] } {
  // `exists: false` services (e.g. Velocity) have no whitelist file at all, so they must
  // not count against the player.
  const checkable = status.services.filter((service) => service.exists)
  const missingServices = checkable.filter((service) => !service.whitelisted).map((service) => service.name)

  if (status.whitelistedEverywhere || (checkable.length > 0 && missingServices.length === 0)) {
    return { state: 'whitelisted', missingServices: [] }
  }

  // Nothing to check against, so we cannot tell whether the player has access. Fail open.
  if (checkable.length === 0) {
    return { state: 'unknown', missingServices: [] }
  }

  if (missingServices.length === 0) {
    return { state: hasRequest ? 'pending' : 'none', missingServices: [] }
  }

  const partial = missingServices.length < checkable.length

  if (partial) return { state: 'partial', missingServices }
  if (hasRequest) return { state: 'pending', missingServices }

  return { state: 'none', missingServices }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
}

export function registerWhitelistHandlers() {
  ipcMain.handle('whitelist:get', async (): Promise<IWhitelistResponse> => {
    const name = readPlayerName()
    if (!name) {
      return { state: 'unknown', status: null, requestedAt: null, missingServices: [] }
    }

    const cache = readCache()
    if (cache.name !== name) {
      cache.name = null
      cache.requestedAt = null
      writeCache(cache)
    }

    try {
      const response = await fetchWithTimeout(`${WHITELIST_URL}?player=${encodeURIComponent(name)}`, {
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        logger.error(`Whitelist check for ${name} returned HTTP ${response.status}`)
        return { state: 'unknown', status: null, requestedAt: cache.requestedAt, missingServices: [] }
      }

      const status = readStatus(await response.json())
      if (!status) {
        logger.error('Whitelist check returned an unexpected payload')
        return { state: 'unknown', status: null, requestedAt: cache.requestedAt, missingServices: [] }
      }

      const { state, missingServices } = resolveState(status, cache.requestedAt !== null)

      cache.name = name
      cache.lastChecked = new Date().toISOString()
      writeCache(cache)

      logger.log(`Whitelist status for ${name}: ${state}`)

      return { state, status, requestedAt: cache.requestedAt, missingServices }
    } catch (err) {
      logger.error('Failed to check whitelist:', (err as Error).message)
      return { state: 'unknown', status: null, requestedAt: cache.requestedAt, missingServices: [] }
    }
  })

  ipcMain.handle('whitelist:request', async (): Promise<IWhitelistRequestResponse> => {
    const name = readPlayerName()
    if (!name) {
      return { ok: false, error: 'You need to be signed in to request access.' }
    }

    try {
      const response = await fetchWithTimeout(REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? 0)
        logger.warn(`Whitelist request rate limited for ${name}, retry after ${retryAfter}`)
        return { ok: false, retryAfter, error: 'Too many requests. Please try again later.' }
      }

      if (response.status !== 200 && response.status !== 202) {
        logger.error(`Whitelist request for ${name} returned HTTP ${response.status}`)
        return { ok: false, error: 'The server rejected the request. Please try again later.' }
      }

      const payload = (await response.json().catch(() => ({}))) as { already?: boolean; note?: string; requestedAt?: string }

      const cache = readCache()
      cache.name = name
      cache.requestedAt = payload.requestedAt ?? new Date().toISOString()
      cache.lastChecked = new Date().toISOString()
      writeCache(cache)

      logger.log(`Whitelist request for ${name} accepted (already: ${payload.already === true})`)

      return { ok: true, already: payload.already === true, note: payload.note }
    } catch (err) {
      logger.error('Failed to request whitelist:', (err as Error).message)
      return { ok: false, error: 'Could not reach the server. Please try again later.' }
    }
  })
}
