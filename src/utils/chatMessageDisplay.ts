/**
 * 用户消息气泡展示逻辑，与 Web `ui/src/pages/chat/chatMessageDisplay.ts` 对齐。
 */

/** 与后端 userTextForMemory 一致：正文前的「[图片×N]」「[文件×N]」或组合（U+00D7） */
export const USER_ATTACHMENT_SUMMARY_RE =
  /^\[(?:图片×\d+|文件×\d+)(?:\s+(?:图片×\d+|文件×\d+))?\]\s*/

/** @deprecated 使用 USER_ATTACHMENT_SUMMARY_RE */
export const USER_IMAGE_SUMMARY_RE = /^\[图片×\d+\]\s*/

export type UserMessageBubbleFields = {
  role: string
  content: string
  image_urls?: string[]
  file_urls?: string[]
  image_data_urls?: string[]
}

/** 气泡内用于 `<img src>` 的地址列表：优先本地预览，否则接口 URL */
export function userMessageImageUrls (m: Pick<UserMessageBubbleFields, 'image_urls' | 'image_data_urls'>): string[] {
  if (m.image_data_urls?.length) return m.image_data_urls
  if (m.image_urls?.length) return m.image_urls
  return []
}

/**
 * 用户气泡内文字：去掉与缩略图/附件列表重复的摘要前缀；无 URL 时勿只显示原始占位串。
 * `t` 为 i18next 的 `t`；占位文案使用 `agentDetail.imageOnlyMessage` / `agentDetail.fileOnlyMessage`。
 */
export function userMessageTextToDisplay (m: UserMessageBubbleFields, t: (key: string) => string): string {
  if (m.role !== 'user') return m.content ?? ''
  const raw = (m.content ?? '').trim()
  const imgUrls = userMessageImageUrls(m)
  const fileUrls = m.file_urls ?? []
  const afterStrip = raw.replace(USER_ATTACHMENT_SUMMARY_RE, '').trim()
  if (imgUrls.length > 0) {
    return afterStrip
  }
  if (fileUrls.length > 0) {
    return afterStrip
  }
  if (USER_ATTACHMENT_SUMMARY_RE.test(raw) && afterStrip === '') {
    if (/\[图片×/.test(raw)) return t('agentDetail.imageOnlyMessage')
    if (/\[文件×/.test(raw)) return t('agentDetail.fileOnlyMessage')
    return t('agentDetail.fileOnlyMessage')
  }
  return afterStrip || raw
}
