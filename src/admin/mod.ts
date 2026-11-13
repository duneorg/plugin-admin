/**
 * Admin panel — barrel exports.
 */

export { getAdminContext, initAdminContext } from "./context.ts";
export type { AdminContext, AdminPageRegistration } from "./context.ts";

export { createSessionManager } from "./auth/sessions.ts";
export type { SessionManager, SessionManagerConfig } from "./auth/sessions.ts";

export { createUserManager } from "./auth/users.ts";
export type { CreateUserInput, UserManager, UserManagerConfig } from "./auth/users.ts";

export { createAuthMiddleware } from "./auth/middleware.ts";
export type { AuthMiddleware, AuthMiddlewareConfig } from "./auth/middleware.ts";

export type { AuthCredentials, AuthProvider, AuthProviderUser } from "./auth/provider.ts";
export { LocalAuthProvider } from "./auth/local-provider.ts";
export { findOrProvisionUser } from "./auth/provisioner.ts";

export type {
  AdminConfig,
  AdminPermission,
  AuthResult,
  Role,
  Session,
  User,
  UserInfo,
} from "./types.ts";
export { toUserInfo } from "./types.ts";

// Submissions
export type {
  Submission,
  SubmissionManager,
  SubmissionMeta,
  SubmissionStatus,
} from "./submissions.ts";

// Editor
export { blocksToMarkdown, markdownToBlocks } from "./editor/serializer.ts";
export { parseMarkdownToBlocks } from "./editor/parser.ts";
export { generateBlockId } from "./editor/types.ts";
export type {
  Block,
  BlockDocument,
  BlockquoteBlock,
  BlockType,
  CodeBlock,
  DividerBlock,
  HeadingBlock,
  HtmlBlock,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  TableBlock,
} from "./editor/types.ts";
