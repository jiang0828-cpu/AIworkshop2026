export type BasicAuthCredentials = {
  email: string;
  password: string;
};

export function isAuthConfigured(credentials: Partial<BasicAuthCredentials>): credentials is BasicAuthCredentials {
  return Boolean(credentials.email?.trim() && credentials.password);
}

export function parseBasicAuth(header: string | null): BasicAuthCredentials | null {
  if (!header?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { email: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function isAuthorized(header: string | null, expected: BasicAuthCredentials) {
  const provided = parseBasicAuth(header);
  return Boolean(
    provided &&
      constantTimeEqual(provided.email, expected.email) &&
      constantTimeEqual(provided.password, expected.password),
  );
}
