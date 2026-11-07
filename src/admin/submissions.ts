/**
 * Form submissions.
 *
 * The store and its types live in `@dune/core/forms` — core accepts public
 * form submissions itself, so a site works without this plugin. This module
 * re-exports the types for the submissions UI. The manager itself is
 * `PluginRuntime.submissions`; there is no factory to import.
 */

export type {
  Submission,
  SubmissionFile,
  SubmissionManager,
  SubmissionManagerConfig,
  SubmissionMeta,
  SubmissionStatus,
} from "@dune/core/forms";
