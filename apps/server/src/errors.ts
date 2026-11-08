export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function unavailable(feature: string): never {
  throw new ApiError(501, 'CAPABILITY_UNAVAILABLE', `${feature} is not exposed by the pinned public Oxen contract.`);
}
