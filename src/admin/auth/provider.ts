/**
 * AuthProvider interface — abstracts identity verification from session management.
 *
 * Providers handle step 1+2 of the login flow (verify identity, return user attributes).
 * The session/cookie/user-provisioning layer in server.ts is shared across all providers.
 *
 * @module
 */

/**
 * User attributes returned by an external auth provider after successful authentication.
 *
 * `roles` is a plain string array — matching `@dune/core`'s unified
 * `User.roles`'s shape — rather than the admin panel's closed `Role` union,
 * per decisions/dec-identity-unification.md's Phase 4: this interface (and
 * the LDAP/SAML bind/ACS verification logic behind it) isn't admin-specific,
 * only its current sole consumer (`findOrProvisionUser()`, which provisions
 * into `data/users/` — the same store public site visitors live in as of
 * Phase 5b) is. A future public-site consumer (`mountDuneAuth()`) can use
 * the array directly against `User.roles`; `findOrProvisionUser()` picks a
 * single admin-tier `Role` out of it (see that file).
 */
export interface AuthProviderUser {
  /** Stable external identifier (LDAP DN, SAML NameID, OpenID sub, local user ID, etc.) */
  externalId: string;
  /** Login name */
  username: string;
  email?: string;
  name?: string;
  /** Roles to assign when auto-provisioning or syncing this user. Empty/absent means "use the consumer's default". */
  roles?: string[];
}

/** Credentials passed to an AuthProvider for direct username+password flows (local, LDAP). */
export interface AuthCredentials {
  username: string;
  password: string;
}

/**
 * An authentication provider handles identity verification.
 * The built-in provider is `local`; any other (LDAP, SAML, OIDC, ...) is injected through
 * the plugin's `authProvider` option. The session and user-provisioning layer is shared.
 *
 * Username+password flows (local, LDAP) use `authenticate()`.
 * Redirect-based flows (SAML, OIDC) use `initiateLogin()` + `handleCallback()`.
 */
export interface AuthProvider {
  readonly type: string;

  /**
   * Verify credentials and return provider user attributes.
   * Returns null on authentication failure (wrong password, user not found, bind error, etc.).
   * Used for local and LDAP username+password flows.
   */
  authenticate(credentials: AuthCredentials): Promise<AuthProviderUser | null>;

  /**
   * Initiate login for redirect-based providers (SAML, OIDC).
   * Returns a URL to redirect the browser to, or null if not applicable to this provider type.
   */
  initiateLogin?(req: Request): Promise<string | null>;

  /**
   * Handle a callback from an external provider (SAML ACS endpoint, OIDC redirect URI).
   * Returns authenticated user attributes or null on failure.
   */
  handleCallback?(req: Request): Promise<AuthProviderUser | null>;
}
