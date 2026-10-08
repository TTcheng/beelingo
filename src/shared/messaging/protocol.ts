/**
 * 消息协议：content ↔ background ↔ popup/options
 *
 * 所有跨上下文消息通过 chrome.runtime.sendMessage 走统一的 envelope：
 *   { type, payload, requestId? }
 * requestId 用于 content → background 的请求关联响应。
 */

export const MessageType = {
  // content → background
  TranslateRequest: 'TRANSLATE_REQUEST',
  ValidateApiKey: 'VALIDATE_API_KEY',

  // background → content
  TranslateResult: 'TRANSLATE_RESULT',
  TranslateError: 'TRANSLATE_ERROR',

  // background → content（触发翻译入口）
  HotkeyTriggered: 'BEELINGO_HOTKEY_TRIGGERED',
  ContextMenuTriggered: 'BEELINGO_CONTEXT_MENU_TRIGGERED',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

// ---------- payloads ----------

export interface TranslateRequestPayload {
  text: string;
  /** 选区矩形（CSS 像素），供气泡定位；可选 */
  rect?: { x: number; y: number; width: number; height: number };
  /** 触发来源，便于做埋点/快捷键区分 */
  source: 'icon' | 'hotkey' | 'contextMenu';
}

export interface TranslateResultPayload {
  translated: string;
  detectedSource?: string;
  latencyMs: number;
  cached: boolean;
}

export type TranslateErrorCode =
  | 'NO_API_KEY'
  | 'NETWORK'
  // 401/403：Key 无效或未授权
  | 'AUTH_ERROR'
  // 402：余额/配额不足
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMIT'
  | 'INVALID_TEXT'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export interface TranslateErrorPayload {
  code: TranslateErrorCode;
  message: string;
  retryable: boolean;
}

export interface ValidateApiKeyPayload {
  ok: boolean;
  error?: string;
}

export interface ContextMenuTriggeredPayload {
  text: string;
}

// ---------- envelope ----------

export interface MessageEnvelope<T = unknown> {
  type: MessageTypeValue;
  payload?: T;
  requestId?: string;
}

export type TranslateRequestMessage = MessageEnvelope<TranslateRequestPayload> & {
  type: typeof MessageType.TranslateRequest;
};
export type TranslateResultMessage = MessageEnvelope<TranslateResultPayload> & {
  type: typeof MessageType.TranslateResult;
};
export type TranslateErrorMessage = MessageEnvelope<TranslateErrorPayload> & {
  type: typeof MessageType.TranslateError;
};

// ---------- helpers ----------

let _seq = 0;
/** 单调递增的请求 ID，用于关联 TRANSLATE_REQUEST 与 TRANSLATE_RESULT/ERROR */
export function newRequestId(): string {
  _seq = (_seq + 1) & 0x7fffffff;
  return `r${Date.now().toString(36)}${_seq.toString(36)}`;
}