import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * 用途：服务端运行时配置（Vercel 环境变量）。
 * 字段：Supabase 连接、管理/RSS token、音频供应商及对外 base URL。
 * 边界：不含 D1/R2；音频走 Vercel Blob；service_role 只允许服务端使用。
 */
export type Env = {
  ADMIN_TOKEN: string
  RSS_TOKEN: string
  AUDIO_PROVIDER: 'mock' | 'rapidapi'
  RAPIDAPI_KEY?: string
  PUBLIC_BASE_URL: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

/**
 * 用途：在响应返回后继续跑转换任务。
 * 入参：promise 为 convertJob 等后台工作。
 * 返回值：无。
 * 边界：受 Vercel 函数 maxDuration 限制，超时后任务可能停在 pending。
 */
export type RuntimeContext = {
  waitUntil: (promise: Promise<unknown>) => void
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env: ${name}`)
  return value
}

/**
 * 用途：从 process.env 组装 Env。
 * 入参：无，读取当前进程环境变量。
 * 返回值：完整 Env。
 * 异常：缺少必要变量时抛错。
 * 边界：AUDIO_PROVIDER 缺省或非法时按 mock。
 */
export function getEnv(): Env {
  return {
    ADMIN_TOKEN: required('ADMIN_TOKEN'),
    RSS_TOKEN: required('RSS_TOKEN'),
    AUDIO_PROVIDER: process.env.AUDIO_PROVIDER === 'rapidapi' ? 'rapidapi' : 'mock',
    RAPIDAPI_KEY: process.env.RAPIDAPI_KEY,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? '',
    SUPABASE_URL: required('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY')
  }
}

/**
 * 用途：用 service_role 创建 Supabase 客户端，绕过 RLS。
 * 入参：Env 中的 URL 与 service_role key。
 * 返回值：无 session 的 SupabaseClient。
 * 异常：无；连接失败在后续查询时报错。
 */
export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}
