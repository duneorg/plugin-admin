/**
 * Form submissions.
 *
 * The store and its types live in `@dune/core/forms` — core accepts public
 * form submissions itself, so a site works without this plugin. This module
 * re-exports them for the submissions UI and for existing importers.
 */

export { createSubmissionManager } from "@dune/core/forms";
export type {
  Submission,
  SubmissionFile,
  SubmissionManager,
  SubmissionManagerConfig,
  SubmissionMeta,
  SubmissionStatus,
} from "@dune/core/forms";
