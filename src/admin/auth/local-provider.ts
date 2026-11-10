/**
 * Local authentication provider — wraps UserManager + verifyPassword into AuthProvider.
 *
 * This is the default provider when no `auth_provider` is configured in site.yaml.
 * It verifies credentials against the local JSON user store in data/users/.
 */

import type { AuthProvider, AuthCredentials, AuthProviderUser } from "./provider.ts";
import type { UserManager } from "./users.ts";
import type { PasswordService } from "@dune/core/plugin-api";

export class LocalAuthProvider implements AuthProvider {
  readonly type = "local" as const;

  constructor(private users: UserManager, private passwords: Pick<PasswordService, "verify" | "dummyHash">) {}

  async authenticate(creds: AuthCredentials): Promise<AuthProviderUser | null> {
    const user = await this.users.getByUsername(creds.username);
    // Always run verifyPassword even when the user is not found to prevent
    // username enumeration via response-time differences (timing oracle).
    const hash = user?.passwordHash ?? this.passwords.dummyHash;
    const valid = await this.passwords.verify(creds.password, hash);
    if (!valid || !user || !user.enabled) return null;
    return {
      externalId: user.id,
      username: user.username ?? user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    };
  }
}
