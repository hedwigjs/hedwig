export type SdkErrorCode =
  | 'RUNTIME_NOT_PROVIDED'
  | 'RUNTIME_TOO_OLD'
  | 'RUNTIME_ALREADY_PROVIDED'
  | 'CLIENT_ID_TAKEN'
  | 'TRANSPORT_UNSUPPORTED'
  | 'TRANSPORT_FANOUT';

/**
 * Every error the SDK throws carries a stable `code` and an actionable
 * message. None of them creates anything as a side effect.
 */
export class HedwigSdkError extends Error {
  readonly code: SdkErrorCode;

  constructor(code: SdkErrorCode, message: string) {
    super(message);
    this.name = 'HedwigSdkError';
    this.code = code;
  }
}
