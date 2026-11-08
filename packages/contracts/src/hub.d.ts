export interface paths {
    "/api/ai/chat/completions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create chat completion
         * @description Generates a model response for the given conversation. Compatible with the OpenAI chat completions API.
         */
        post: operations["OxenApiWeb.Controllers.ModelController.get_model_response"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/generations/_filters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the values each filter column takes
         * @description Distinct values for each requested filter column, so a client can populate filter dropdowns with choices that actually match rows. Scope params (`namespace`, `user_id`) apply; the list endpoint's own filter params do not, so a selected value never narrows its own column.
         */
        get: operations["OxenApiWeb.Controllers.GenerationsController.list_filter_values"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/orgs/{name}/fine_tunes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List fine-tunes for an organization
         * @description Return all fine-tune jobs in repositories belonging to the given organization. Requires the authenticated user to be a member of the organization.
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.list_for_team"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/generations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List past generations
         * @description Paginated browse view of completed and in-flight generations for a namespace. Use `/api/ai/queue` for the lean polling view of in-flight rows.
         */
        get: operations["OxenApiWeb.Controllers.GenerationsController.index"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/evaluations/{evaluation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get evaluation status
         * @description Fetch a single evaluation by ID. Use this to poll for progress (`evaluation.progress.processed` / `evaluation.progress.total`) and completion (`evaluation.status`).
         */
        get: operations["OxenApiWeb.Controllers.EvaluationController.get_evaluation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/actions/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run a fine-tune job
         * @description Kick off a run for an existing fine-tune. The job must be in a runnable state (created or tokenizing).
         */
        post: operations["OxenApiWeb.Controllers.FineTuneController.run"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a fine-tune job
         * @description Fetch a single fine-tune job by ID within a repository.
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.show"];
        put?: never;
        post?: never;
        /**
         * Delete a fine-tune job
         * @description Delete a fine-tune job and any associated model metadata.
         */
        delete: operations["OxenApiWeb.Controllers.FineTuneController.delete"];
        options?: never;
        head?: never;
        /**
         * Rename or describe a fine-tune job
         * @description Change a fine-tune job's display name and description. Other fields in the body are ignored.
         */
        patch: operations["OxenApiWeb.Controllers.FineTuneController.update"];
        trace?: never;
    };
    "/api/ai/models/{id}/estimate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Estimate a generation's cost
         * @description Estimates what a generation with these parameters would cost, from the same pricing that bills it. `kind` is `exact`, `range` (the parameters leave the length or size open), `rate` (billed by usage only known after the run; see `rates`) or `unknown`. The final charge is always computed from the run's actual usage.
         */
        post: operations["OxenApiWeb.Controllers.ModelsController.estimate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/images/edit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Edit image
         * @description Edits an image given a prompt and source image.
         */
        post: operations["OxenApiWeb.Controllers.ModelController.edit_image"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Retrieve model
         * @description Retrieves a model by ID or name. OpenAI-compatible.
         */
        get: operations["OxenApiWeb.Controllers.ModelsController.show"];
        /** Update model */
        put: operations["OxenApiWeb.Controllers.ModelsController.update"];
        post?: never;
        /** Delete custom model */
        delete: operations["OxenApiWeb.Controllers.ModelsController.delete_custom_model"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/checkpoints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List checkpoints for a fine-tune job
         * @description Retrieve all saved checkpoints for a fine-tune training run. Returns an empty list if the model branch has not been created yet (e.g. before training has produced checkpoints).
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.checkpoints"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search models */
        get: operations["OxenApiWeb.Controllers.ModelsController.search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/generations/{generation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get generation details
         * @description Full metadata for a single generation, including cost and the user who triggered it.
         */
        get: operations["OxenApiWeb.Controllers.GenerationsController.show"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get logs for a fine-tune job
         * @description Fetch aggregated logs for a specific fine-tune run.
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.logs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models/featured": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List featured models */
        get: operations["OxenApiWeb.Controllers.ModelsController.list_featured"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/queue/{generation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get generation status
         * @description Retrieves metadata for a single queued generation.
         */
        get: operations["OxenApiWeb.Controllers.QueueController.show"];
        put?: never;
        post?: never;
        /**
         * Cancel generation
         * @description Cancels a generation. The row is retained with status set to cancelled.
         */
        delete: operations["OxenApiWeb.Controllers.QueueController.delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/actions/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stop a running fine-tune job
         * @description Stop a fine-tune if it is currently running or queued.
         */
        post: operations["OxenApiWeb.Controllers.FineTuneController.stop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/images/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate image
         * @description Creates an image from a text prompt.
         */
        post: operations["OxenApiWeb.Controllers.ModelController.generate_image"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate model deployment */
        post: operations["OxenApiWeb.Controllers.ModelsController.deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Activate model deployment
         * @description Activates an inactive model deployment.
         */
        post: operations["OxenApiWeb.Controllers.ModelsController.wake"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/checkpoints/{step}/deploy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Deploy a checkpoint from a fine-tune job
         * @description Deploy a specific training checkpoint to make it available for inference. Pass `retry=true` to tear down any existing deployment for this checkpoint before creating a new one.
         */
        post: operations["OxenApiWeb.Controllers.FineTuneController.create_checkpoint_deployment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/queue/{generation_id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kill & retry generation
         * @description Cancels a generation (and any live job backing it), then enqueues a fresh generation with the same parameters. The original row is retained with status cancelled and the new row links back to it via `retried_from_id`. A generation that already succeeded cannot be retried.
         */
        post: operations["OxenApiWeb.Controllers.QueueController.retry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/audio/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate audio
         * @description Creates audio (e.g. speech) from a text prompt.
         */
        post: operations["OxenApiWeb.Controllers.ModelController.generate_audio"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/tokenize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Tokenize data for a fine-tune job
         * @description Trigger tokenization for a fine-tune that is in created state.
         */
        post: operations["OxenApiWeb.Controllers.FineTuneController.tokenize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models/favorites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List favorite models */
        get: operations["OxenApiWeb.Controllers.ModelsController.list_favorites"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/train_status/{new_status}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update training status for a fine-tune job
         * @description Update the training status of a fine-tune job.
         */
        put: operations["OxenApiWeb.Controllers.FineTuneController.update_train_status"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes/{id}/train_status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get training status for a fine-tune job
         * @description Retrieve the current training status of a fine-tune job.
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.get_train_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workbench/references/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resolve workbench input URLs
         * @description Turns input URLs a client saved earlier into URLs that load now. A branch or workspace URL into `oxen/context/` or `oxen/outputs/` that the v3 workbench migration left dead is re-pointed at a commit from before the migration that holds the file. Each URL is checked against the caller's read access on its own repo; a URL into a repo the caller cannot read comes back `unknown` without being looked up.
         */
        post: operations["OxenApiWeb.Controllers.WorkbenchReferenceController.resolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List models
         * @description Lists all available models. OpenAI-compatible.
         */
        get: operations["OxenApiWeb.Controllers.ModelsController.index"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/fine_tunes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List fine-tunes in a repository
         * @description Return the fine-tune jobs associated with a given repository.
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.index"];
        put?: never;
        /**
         * Create a fine-tune job
         * @description Start a new fine-tune for a given repository.
         */
        post: operations["OxenApiWeb.Controllers.FineTuneController.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/evaluations/*resource_path": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an evaluation
         * @description Run model inference over a dataset in the repository. The resource path (branch and file) is encoded in the URL, e.g. `POST /api/repos/{ns}/{repo}/evaluations/main/datasets/training.parquet`.
         */
        post: operations["OxenApiWeb.Controllers.EvaluationController.create_evaluation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List in-flight queue items
         * @description Lean polling view of the workbench render queue. Returns active generations (status queued or processing) by default; pass an explicit `status=` filter to include terminal rows. For paginated history with cost aggregates, use `/api/ai/generations`.
         */
        get: operations["OxenApiWeb.Controllers.QueueController.index"];
        put?: never;
        /**
         * Enqueue generation
         * @description Enqueues an async image or video generation job.
         */
        post: operations["OxenApiWeb.Controllers.QueueController.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/user/fine_tunes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List all fine-tunes accessible to the current user
         * @description Return all fine-tune jobs the authenticated user has access to, including their own repositories and repositories in organizations they belong to.
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.list_accessible"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{username}/fine_tunes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List fine-tunes for a user
         * @description Return all fine-tune jobs in repositories belonging to the given user. Only the user themselves can access this endpoint.
         */
        get: operations["OxenApiWeb.Controllers.FineTuneController.list_for_user"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/videos/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate video
         * @description Creates a video from a text prompt.
         */
        post: operations["OxenApiWeb.Controllers.ModelController.generate_video"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ai/models/{id}/favorite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Favorite a model */
        post: operations["OxenApiWeb.Controllers.ModelsController.create_favorite"];
        /** Unfavorite a model */
        delete: operations["OxenApiWeb.Controllers.ModelsController.delete_favorite"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AudioGenerateResponse */
        AudioGenerateResponse: {
            audios?: {
                url?: string;
            }[];
            created?: number;
            model?: string;
        };
        /** ImageGenerateRequest */
        ImageGenerateRequest: {
            /** @description Model ID to use for image generation */
            model: string;
            /**
             * @description Number of images to generate
             * @default 1
             */
            n: number;
            /** @description Text prompt describing the desired image */
            prompt: string;
            seed?: number | null;
            /** @description Image size */
            size?: string | null;
        };
        /** QueueCreateResponse */
        QueueCreateResponse: {
            generations: {
                /** Format: uuid */
                generation_id: string;
                /** @enum {string} */
                status: "queued";
            }[];
        };
        /** WorkbenchReferencesResolveResponse */
        WorkbenchReferencesResolveResponse: {
            /** @description One entry per requested URL, in request order. */
            references: {
                /** @description The URL to store in place of `url`, pinned to a commit that holds the file and unsigned, in the form of `url` (a relative URL stays relative). Present for a `live` branch URL, a `live` workspace URL whose file the workspace has not changed, and a `recovered` URL. Null for a file only staged in a workspace, which only a commit can pin, for a URL already pinned, and for every other status. */
                pinned_url: string | null;
                /** @description `live`: the URL presigned. `recovered`: the URL pinned to that commit, presigned. `missing`: null. `unknown` and `skipped`: the URL unchanged. */
                resolved_url: string | null;
                /**
                 * @description `live`: the file is where the URL names it. `recovered`: it is not, and a commit from before the v3 workbench migration holds it. `missing`: no such file. `unknown`: the lookup failed, the caller cannot read the repo the URL names, or the file was not found while a migration is running on that repo. `skipped`: not a hub file URL.
                 * @enum {string}
                 */
                status: "live" | "recovered" | "missing" | "unknown" | "skipped";
                /** @description The URL as requested. */
                url: string;
            }[];
            /** @enum {string} */
            status: "success";
        };
        /** ChatCompletionResponse */
        ChatCompletionResponse: {
            choices?: {
                finish_reason?: string;
                index?: number;
                message?: {
                    content?: string | null;
                    role?: string;
                    tool_calls?: Record<string, never>[] | null;
                };
            }[];
            created?: number;
            id?: string;
            model?: string;
            /** @enum {string} */
            object?: "chat.completion";
            usage?: {
                completion_tokens?: number;
                prompt_tokens?: number;
                /** @description Present when the provider reported prompt-cache activity. cached_tokens counts prompt tokens served from the provider's prompt cache; they are included in prompt_tokens. */
                prompt_tokens_details?: {
                    cached_tokens?: number;
                } | null;
                total_tokens?: number;
            } | null;
        };
        /**
         * CreateFineTuneRequest
         * @description Request payload to create a fine-tune job for a repository.
         */
        CreateFineTuneRequest: {
            /** @description Canonical name of the base model to fine-tune */
            base_model: string;
            /**
             * @description Whether the resulting fine-tuned model should be public. Defaults to false.
             * @default false
             */
            is_public: boolean;
            /** @description Optional override for where the resulting model weights live in Oxen. Defaults to the fine-tune resource. */
            oxen_model_path?: string | null;
            /** @description Repository path to the training data file or directory */
            resource: string;
            /** @description Name of the fine-tune script to run */
            script_type: string;
            /** @description Training configuration parameters */
            training_params?: {
                /** @description Per-device batch size used during training. */
                batch_size?: number;
                /** @description Name of the column containing text captions or prompts. */
                caption_column?: string;
                /** @description Number of steps to accumulate gradients before an optimizer step. */
                gradient_accumulation?: number;
                /** @description Name of the column containing image file paths. */
                image_column?: string;
                /**
                 * Format: float
                 * @description Base learning rate for the optimizer.
                 */
                learning_rate?: number;
                /** @description LoRA alpha scaling factor for LoRA fine-tuning approaches. */
                lora_alpha?: number;
                /** @description LoRA rank used for low-rank adaptation layers. */
                lora_rank?: number;
                /** @description Interval (in steps) at which to generate samples. */
                sample_every?: number;
                /** @description Number of sample generations to produce at each sampling interval. */
                samples?: number;
                /** @description Total number of training steps to run. */
                steps?: number;
                /** @description Strategy for sampling timesteps during training (for example, 'weighted'). */
                timestep_type?: string;
                /**
                 * @description Whether to use LoRA fine-tuning (true) or full fine-tuning (false). If omitted, defaults to true.
                 * @default true
                 */
                use_lora: boolean;
            } & {
                [key: string]: unknown;
            };
        };
        /** AudioGenerateRequest */
        AudioGenerateRequest: {
            /** @description Reference audio URLs for voice cloning */
            audio_urls?: string[] | null;
            /** @description Reference image URL */
            image_url?: string | null;
            model: string;
            /** @description wav, mp3, pcm, or ogg_opus */
            output_format?: string | null;
            pitch?: number | null;
            /** @description Text prompt or text to synthesize */
            prompt: string;
            /** @description url (default) or b64_json */
            response_format?: string | null;
            /** @description Output sample rate in Hz */
            sample_rate?: number | null;
            /** @description Persist the generated audio to the workbench (default true) */
            save_to_workbench?: boolean | null;
            speed?: number | null;
            /** @description Preset voice name or cloned voice ID */
            voice?: string | null;
            volume?: number | null;
        };
        /** VideoGenerateResponse */
        VideoGenerateResponse: {
            created?: number;
            model?: string;
            videos?: ({
                draft_expires_at?: string | null;
                draft_task_id?: string | null;
                /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                text?: string | null;
                url?: string;
            } & {
                [key: string]: unknown;
            })[];
        };
        /**
         * FineTuneRun
         * @description Fine-tune job payload as returned by the /run API.
         */
        FineTuneRun: {
            /** @description Canonical name of the base model, e.g. 'Qwen/Qwen3-0.6B' */
            base_model?: string;
            /** @description User who created the fine-tune job */
            created_by?: {
                /** @description User ID */
                id?: string;
                /** @description Avatar image URL */
                image?: string | null;
                /** @description Display name */
                name?: string | null;
                /** @description Username */
                username?: string;
            };
            /** @description Credits used so far for this fine-tune */
            credits_used?: string;
            /** @description Deployment information for the resulting model, if deployed */
            deployed_model?: {
                [key: string]: unknown;
            } | null;
            /** @description Optional description of the fine-tune */
            description?: string | null;
            /** @description Optional display name for the fine-tune */
            display_name?: string | null;
            /** @description Error message if the fine-tune failed */
            error?: string | null;
            /** @description Fine-tune script configuration used for this run */
            fine_tune_script?: {
                /** @description Description of what the script does */
                description?: string;
                /** @description Human-friendly name for the script */
                display_name?: string;
                /** @description Docker image used to run the script */
                docker_image_name?: string;
                /** @description Fine-tune configuration schema used by the script */
                fine_tune_schema?: {
                    /** @description Schema description */
                    description?: string;
                    /** @description Fine-tune schema ID */
                    id?: string;
                    /** @description Schema name */
                    name?: string;
                    /** @description JSON schema describing training params UI */
                    schema?: {
                        additionalProperties?: boolean;
                        basic?: string[];
                        /** @description Per-parameter schema; structure is flexible */
                        properties?: {
                            [key: string]: unknown;
                        };
                        required?: string[];
                        type?: string;
                    } & {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
                /** @description Fine-tune script ID */
                id?: string;
                /** @description Fine-tune script name */
                name?: string;
                /** @description Type of script (for example, 'text_generation') */
                script_type?: string;
            };
            /**
             * Format: date_time
             * @description Time when training finished
             */
            finished_at?: string | null;
            /** @description Number of GPUs requested for the job */
            gpu_count?: number;
            /** @description GPU model requested for the job (for example, 'A10G') */
            gpu_model?: string;
            /** @description Fine-tune ID */
            id?: string;
            /**
             * Format: date_time
             * @description Creation timestamp
             */
            inserted_at?: string;
            /**
             * Format: date_time
             * @description Last time credits were checked for this job
             */
            last_credit_check?: string | null;
            /** @description Fine-tune name */
            name?: string;
            /** @description Optional output resource produced by this fine-tune */
            output_resource?: {
                [key: string]: unknown;
            } | null;
            /** @description Queue position if the job is queued */
            queue_position?: number | null;
            /** @description Billing rate per second for this fine-tune */
            rate_per_second?: string;
            /** @description ID of the repository this fine-tune belongs to */
            repository_id?: string;
            /** @description Training data resource used for this fine-tune */
            resource?: {
                /** @description Path to the resource inside the repository */
                path?: string;
                /** @description Commit or version identifier */
                version?: string;
            };
            /** @description Base model that is being fine-tuned */
            source_model?: {
                [key: string]: unknown;
            };
            /**
             * Format: date_time
             * @description Time when training actually started
             */
            started_at?: string | null;
            /** @description Current status of the fine-tune */
            status?: string;
            /**
             * @description Total number of tokens processed
             * @default 0
             */
            total_token_count: number;
            /** @description Training parameters used for this fine-tune run */
            training_params?: {
                /** @description Column containing assistant responses */
                answer_column?: string;
                /** @description Per-device batch size used during training */
                batch_size?: number;
                /** @description Whether to enable thinking tokens during training */
                enable_thinking?: boolean;
                /** @description Number of epochs to train for */
                epochs?: number;
                /** @description Gradient accumulation steps */
                grad_accum?: number;
                /**
                 * Format: float
                 * @description Base learning rate for the optimizer
                 */
                learning_rate?: number;
                /** @description Interval (in steps) at which logs are written */
                logging_steps?: number;
                /** @description LoRA alpha scaling factor */
                lora_alpha?: number;
                /** @description LoRA rank for low-rank adapters */
                lora_rank?: number;
                /**
                 * Format: float
                 * @description NEFTune noise alpha
                 */
                neftune_noise_alpha?: number;
                /** @description Column containing user prompts */
                question_column?: string;
                /**
                 * Format: float
                 * @description Ratio of steps at which to save checkpoints
                 */
                save_steps_ratio?: number;
                /** @description Save strategy, e.g. 'epoch' */
                save_strategy?: string;
                /** @description Sequence length used during training */
                seq_length?: number;
                /** @description Whether LoRA is enabled for this run */
                use_lora?: boolean;
            };
            /**
             * Format: date_time
             * @description Last update timestamp
             */
            updated_at?: string;
            /** @description Whether LoRA fine-tuning is enabled */
            use_lora?: boolean;
        } & {
            [key: string]: unknown;
        };
        /** ImageGenerateResponse */
        ImageGenerateResponse: {
            created?: number;
            images?: {
                revised_prompt?: string | null;
                url?: string;
            }[];
            model?: string;
        };
        /**
         * CheckpointListResponse
         * @description Standard wrapper for the list-checkpoints response.
         */
        CheckpointListResponse: {
            /** @description Oxen branch where the model and its checkpoints are stored. */
            branch?: string;
            /** @description Checkpoints saved during the fine-tune run, sorted by step ascending. */
            checkpoints?: components["schemas"]["Checkpoint"][];
            /** @description ID of the fine-tune job these checkpoints belong to. */
            fine_tune_id?: string;
            /** @description High-level status string (for example, 'success'). */
            status?: string;
            /** @description Human-readable status message (for example, 'resource_found'). */
            status_message?: string;
            /** @description Total number of checkpoints returned. */
            total_checkpoints?: number;
        };
        /**
         * QueueListResponse
         * @description Lean polling view of the workbench render queue. Active (`queued`/`processing`) rows by default; pass an explicit `status=` filter to include terminal rows. For paginated browse with cost aggregates, see `/api/ai/generations`.
         */
        QueueListResponse: {
            count: number;
            generations: {
                audios?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** @description Unix timestamp */
                completed_at?: number | null;
                /** @description Unix timestamp */
                enqueued_at: number;
                error_message?: string | null;
                /** @description Upstream provider the failure came from */
                error_provider?: string | null;
                /** @description Provider's own error code, when it gave one */
                error_provider_code?: string | null;
                /** @description Whether retrying the same request could plausibly succeed */
                error_retryable?: boolean | null;
                /**
                 * @description Where a failure originated, so a provider refusal reads differently from an Oxen fault
                 * @enum {string|null}
                 */
                error_source?: "user" | "provider_policy" | "provider" | "oxen" | null;
                /** Format: uuid */
                generation_id: string;
                images?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** @enum {string} */
                media_type: "image" | "video" | "audio" | "text";
                model_name: string;
                result_url?: string | null;
                /**
                 * Format: uuid
                 * @description Id of the generation this row is a kill & retry of, when applicable
                 */
                retried_from_id?: string | null;
                /** @description Unix timestamp */
                started_at?: number | null;
                /** @enum {string} */
                status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
                target_directory?: string | null;
                target_namespace?: string | null;
                target_repo?: string | null;
                texts?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                videos?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
            }[];
        };
        /**
         * Checkpoint
         * @description A single training checkpoint produced by a fine-tune run. Each checkpoint
         *     corresponds to a step directory in the model's Oxen branch and may carry
         *     metrics, inference samples, and (if previously deployed) deployment status.
         */
        Checkpoint: {
            /**
             * Format: date_time
             * @description Timestamp of the commit that produced this checkpoint.
             */
            created_at?: string | null;
            /** @description Current Baseten deployment status for this checkpoint, if it has been deployed. */
            deployment_status?: string | null;
            /** @description Sample generations produced at this checkpoint, if any. */
            inference_samples?: {
                [key: string]: unknown;
            }[];
            /** @description Training metrics recorded at this step (when training logs are available). */
            metrics?: {
                /** Format: float */
                epoch?: number | null;
                /** Format: float */
                grad_norm?: number | null;
                /** Format: float */
                learning_rate?: number | null;
                /** Format: float */
                loss?: number | null;
                /** Format: float */
                mean_token_accuracy?: number | null;
            } & {
                [key: string]: unknown;
            };
            /** @description ID of the deployed Model row backing this checkpoint, if it has been deployed. */
            model_id?: string | null;
            /** @description Canonical model name used when this checkpoint is deployed (e.g. '<fine_tune_name>-step-<step>'). */
            model_name?: string;
            /** @description Path within the model branch where the checkpoint is stored. */
            path?: string;
            /** @description Total size in bytes of the checkpoint directory. */
            size_bytes?: number | null;
            /** @description Training step number this checkpoint was saved at. */
            step?: number;
        };
        /** QueueDeleteResponse */
        QueueDeleteResponse: {
            /** Format: uuid */
            generation_id: string;
            /** @enum {string} */
            status: "success";
        };
        /**
         * GenerationsListResponse
         * @description Paginated browse view of past generations for a namespace. Includes the per-filter cost aggregate. Each row carries any additional request params (prompt, duration, etc.) merged in at the top level.
         */
        GenerationsListResponse: {
            /** @description Number of entries in this response (<= page_size) */
            count: number;
            generations: {
                audios?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** @description Unix timestamp */
                completed_at?: number | null;
                /** @description Charged amount for this row (decimal as string). */
                cost?: string | null;
                /** @description Unix timestamp */
                enqueued_at: number;
                error_message?: string | null;
                /** Format: uuid */
                generation_id: string;
                images?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** @enum {string} */
                media_type: "image" | "video" | "audio" | "text";
                model_name: string;
                result_url?: string | null;
                /** @description Unix timestamp */
                started_at?: number | null;
                /** @enum {string} */
                status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
                target_directory?: string | null;
                target_namespace?: string | null;
                target_repo?: string | null;
                texts?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** Format: uuid */
                user_id?: string | null;
                user_image?: string | null;
                username?: string | null;
                videos?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
            }[];
            /** @description Current page number (1-indexed) */
            page_number: number;
            page_size: number;
            /** @description Sum of charged amounts across the filter set (decimal as string). Null when nothing in the set has been charged. */
            total_cost: string | null;
            total_entries: number;
            total_pages: number;
        };
        /**
         * ChatCompletionRequest
         * @description Request to generate a chat completion. Compatible with the OpenAI chat completions API.
         */
        ChatCompletionRequest: {
            frequency_penalty?: number | null;
            max_tokens?: number | null;
            messages: {
                content: string | Record<string, never>[];
                name?: string | null;
                /** @enum {string} */
                role: "system" | "user" | "assistant" | "tool";
                tool_call_id?: string | null;
                tool_calls?: Record<string, never>[] | null;
            }[];
            /**
             * @description Model ID to use
             * @example gpt-4o
             */
            model: string;
            presence_penalty?: number | null;
            /** @description Reasoning/thinking effort for models that support it (e.g. "low", "medium", "high"). Accepted values vary by model: OpenAI reasoning models take minimal/low/medium/high, Claude models take low/medium/high/xhigh/max, Kimi K3 only supports max. Ignored by models without configurable reasoning. */
            reasoning_effort?: string | null;
            response_format?: Record<string, never> | null;
            /**
             * @description Processing tier, as on OpenAI and OpenRouter. "auto" (the default) runs at the standard tier; "ultrafast" opts into OpenAI's Ultrafast mode on models that offer it (GPT 6.1 Sol, GPT 6 Astra) at its higher per-token price. The other tier names (default, flex, priority, fast) are accepted; a tier the model does not price runs at the standard tier. The response's top-level `service_tier` reports the tier actually served, and the request bills at that tier's rates.
             * @default auto
             */
            service_tier: string | null;
            /** @default false */
            stream: boolean;
            temperature?: number | null;
            tool_choice?: (string | Record<string, never>) | null;
            tools?: Record<string, never>[] | null;
            top_p?: number | null;
        };
        /**
         * QueueCreateRequest
         * @description Enqueue an async image or video generation job. `prompt` is required unless `draft_task_id` renders the final video from a Seedance draft, which reuses the draft's prompt, media, and settings.
         */
        QueueCreateRequest: {
            aspect_ratio?: string | null;
            /** @description Seedance 2.5: render a quick 480p draft whose `draft_task_id` can render the final video. */
            draft?: boolean | null;
            /** @description Seedance 2.5: render the final 1080p video from this draft. No prompt is needed. */
            draft_task_id?: string | null;
            duration?: number | null;
            /** @description Model ID to use */
            model: string;
            /** @default 1 */
            num_generations: number;
            /** @description Text prompt for generation */
            prompt?: string | null;
            seed?: number | null;
            target_directory?: string | null;
            /** @description Namespace to store results. Defaults to current user. */
            target_namespace?: string | null;
            target_repo?: string | null;
            /**
             * Format: uuid
             * @description Workbench session (tab) this generation belongs to. Must name an existing, non-deleted session on the target repository that the caller may use.
             */
            workbench_session_id?: string | null;
        };
        /**
         * QueueGenerationResponse
         * @description Compact status payload for a single queued generation, used by the workbench to poll progress. For the full payload (cost, user, etc.), see `/api/ai/generations/:id`.
         */
        QueueGenerationResponse: {
            audios?: ({
                draft_expires_at?: string | null;
                draft_task_id?: string | null;
                /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                text?: string | null;
                url?: string;
            } & {
                [key: string]: unknown;
            })[] | null;
            /** @description Unix timestamp */
            completed_at?: number | null;
            /** @description Unix timestamp */
            enqueued_at: number;
            error_message?: string | null;
            /** @description Upstream provider the failure came from */
            error_provider?: string | null;
            /** @description Provider's own error code, when it gave one */
            error_provider_code?: string | null;
            /** @description Whether retrying the same request could plausibly succeed */
            error_retryable?: boolean | null;
            /**
             * @description Where a failure originated, so a provider refusal reads differently from an Oxen fault
             * @enum {string|null}
             */
            error_source?: "user" | "provider_policy" | "provider" | "oxen" | null;
            /** Format: uuid */
            generation_id: string;
            images?: ({
                draft_expires_at?: string | null;
                draft_task_id?: string | null;
                /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                text?: string | null;
                url?: string;
            } & {
                [key: string]: unknown;
            })[] | null;
            /** @enum {string} */
            media_type: "image" | "video" | "audio" | "text";
            model_name: string;
            result_url?: string | null;
            /**
             * Format: uuid
             * @description Id of the generation this row is a kill & retry of, when applicable
             */
            retried_from_id?: string | null;
            /** @description Unix timestamp */
            started_at?: number | null;
            /** @enum {string} */
            status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
            target_directory?: string | null;
            target_namespace?: string | null;
            target_repo?: string | null;
            texts?: ({
                draft_expires_at?: string | null;
                draft_task_id?: string | null;
                /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                text?: string | null;
                url?: string;
            } & {
                [key: string]: unknown;
            })[] | null;
            videos?: ({
                draft_expires_at?: string | null;
                draft_task_id?: string | null;
                /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                text?: string | null;
                url?: string;
            } & {
                [key: string]: unknown;
            })[] | null;
        };
        /**
         * VideoGenerateRequest
         * @description `prompt` is required unless `draft_task_id` renders the final video from a draft, which reuses the draft's prompt, media, and settings.
         */
        VideoGenerateRequest: {
            aspect_ratio?: string | null;
            /** @description Seedance 2.5: render a quick 480p draft whose `draft_task_id` can render the final video. */
            draft?: boolean | null;
            /** @description Seedance 2.5: render the final 1080p video from this draft. No prompt is needed. */
            draft_task_id?: string | null;
            /** @description Duration in seconds */
            duration?: number | null;
            model: string;
            /** @description Text prompt describing the desired video */
            prompt?: string | null;
            seed?: number | null;
        };
        /**
         * FineTuneStopResponse
         * @description Standard wrapper for fine-tune /stop responses.
         */
        FineTuneStopResponse: {
            /** @description Fine-tune job resource as returned by /stop */
            fine_tune?: components["schemas"]["FineTuneRun"];
            /** @description High-level status string (for example, 'success'). */
            status?: string;
            /** @description Human-readable status message (for example, 'resource_found'). */
            status_message?: string;
        };
        /**
         * EvaluationResponse
         * @description Standard response wrapper for a single evaluation.
         */
        EvaluationResponse: {
            /** @description Evaluation resource */
            evaluation?: components["schemas"]["Evaluation"];
            /** @description High-level status string (for example, 'success'). */
            status?: string;
            /** @description Human-readable status message (for example, 'resource_found'). */
            status_message?: string;
        };
        /**
         * QueueRetryResponse
         * @description Result of a kill & retry: `generation_id` is the freshly enqueued generation, `retried_from_id` the cancelled original.
         */
        QueueRetryResponse: {
            /** Format: uuid */
            generation_id: string;
            /** Format: uuid */
            retried_from_id: string;
            /** @enum {string} */
            status: "success";
        };
        /**
         * FineTuneResponse
         * @description Standard wrapper for fine-tune responses.
         */
        FineTuneResponse: {
            /** @description Fine-tune job resource */
            fine_tune?: components["schemas"]["FineTune"];
            /** @description High-level status string (for example, 'success'). */
            status?: string;
            /** @description Human-readable status message (for example, 'resource_found'). */
            status_message?: string;
        };
        /**
         * GenerationsShowResponse
         * @description Standard success envelope wrapping a single generation under `generation`. The inner object is the same per-row shape returned by the list endpoint (request params merged in at the top level), so the frontend can reuse one type for both.
         */
        GenerationsShowResponse: {
            generation: {
                audios?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** @description Unix timestamp */
                completed_at?: number | null;
                /** @description Charged amount for this row (decimal as string). */
                cost?: string | null;
                /** @description Unix timestamp */
                enqueued_at: number;
                error_message?: string | null;
                /** Format: uuid */
                generation_id: string;
                images?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** @enum {string} */
                media_type: "image" | "video" | "audio" | "text";
                model_name: string;
                result_url?: string | null;
                /** @description Unix timestamp */
                started_at?: number | null;
                /** @enum {string} */
                status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
                target_directory?: string | null;
                target_namespace?: string | null;
                target_repo?: string | null;
                texts?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
                /** Format: uuid */
                user_id?: string | null;
                user_image?: string | null;
                username?: string | null;
                videos?: ({
                    draft_expires_at?: string | null;
                    draft_task_id?: string | null;
                    /** @description A text result's text (a transcript); the full JSON result is the file at `url`. */
                    text?: string | null;
                    url?: string;
                } & {
                    [key: string]: unknown;
                })[] | null;
            };
            /** @example success */
            status: string;
            /** @example resource_found */
            status_message: string;
        };
        /**
         * Model
         * @description Represents a model available for inference or fine-tuning. Compatible with the OpenAI model object.
         */
        Model: {
            capabilities?: {
                input?: string[];
                output?: string[];
                /** @description What an agent should pick this model for, among models with its output. */
                recommended_for?: ("fast" | "cheap" | "best")[];
                /** @description True for a chat model that can call tools. */
                tools?: boolean;
            };
            /** @description Provider-documented context window: total tokens the model can attend to. Null for models without a documented window (e.g. image/video models). */
            context_length?: number | null;
            /** @description Unix timestamp when the model was registered */
            created: number;
            /** @description Active deployments. Empty for base models. */
            deployments?: {
                /** @enum {string} */
                status?: "active" | "inactive" | "deploying" | "deactivating" | "error" | "unknown";
            }[];
            description?: string | null;
            developer?: {
                logo?: string | null;
                name?: string;
            } | null;
            display_name?: string;
            /**
             * @description API endpoint to call this model
             * @enum {string}
             */
            endpoint?: "/chat/completions" | "/images/generate" | "/videos/generate" | "/audio/generate" | "/ai/queue";
            /** @description Fine-tuning info, or null if model is not fine-tuneable */
            fine_tuning?: {
                /** @description Supported fine-tune action types */
                actions?: string[];
                cost_per_second?: number | null;
            } | null;
            /** @description Model identifier used in API calls */
            id: string;
            image_url?: string | null;
            /** @description Maximum tokens a single completion can produce. Null when the provider does not document a cap. */
            max_output_tokens?: number | null;
            /** @enum {string} */
            model_type?: "base" | "custom";
            /** @enum {string} */
            object: "model";
            /** @description "oxen" for base models, owner namespace for custom models */
            owned_by: string;
            pricing?: {
                /** @description Rate billed per prompt token served from the provider's prompt cache (reported as prompt_tokens_details.cached_tokens in usage). Absent means cached tokens bill at input_cost_per_token. */
                cached_input_cost_per_token?: number | null;
                /** @description Rate billed per character of input text, for per_character models. */
                cost_per_character?: number | null;
                /** @description Rate billed per provider credit the run consumes, for per_provider_credit models. Prefer the estimate endpoint, which prices a request in dollars. */
                cost_per_credit?: number | null;
                cost_per_image?: number | null;
                /** @description Cost per image keyed by quality then resolution tier (e.g. {"high": {"4K": 1.47}}). An "input_image" row, when present, is the charge per reference image on top of the output. */
                cost_per_image_grid?: {
                    [key: string]: {
                        [key: string]: number;
                    };
                } | null;
                /** @description Rate billed per second of the uploaded input audio, for per_audio_input_second models. */
                cost_per_input_second?: number | null;
                /** @description Rate billed per megapixel of output image, for models priced by output area. It takes precedence when the response reports an output size; a model may still carry cost_per_image or cost_per_image_grid, which bill when no size is reported. */
                cost_per_megapixel?: number | null;
                cost_per_second?: number | null;
                /** @description Cost per output second keyed by resolution (e.g. {"480p": 0.096}) */
                cost_per_second_by_resolution?: {
                    [key: string]: number;
                } | null;
                cost_per_second_high_res?: number | null;
                cost_per_second_with_audio?: number | null;
                input_cost_per_token?: number | null;
                /** @description Output megapixels one credit covers, for per_provider_credit image models billed ceil(output MP / megapixels_per_credit) credits. cost_per_credit / megapixels_per_credit is the price per output megapixel, charged in whole steps. */
                megapixels_per_credit?: number | null;
                /** @enum {string} */
                method?: "token" | "time" | "per_image" | "per_video_output_second" | "per_audio_output_second" | "per_audio_input_second" | "per_character" | "per_provider_credit";
                output_cost_per_token?: number | null;
            };
            released_at?: string | null;
            /** @description JSON Schema describing model-specific parameters */
            request_schema?: Record<string, never> | null;
            /** @description Optional marketing content rendered on the public model showcase page */
            showcase?: {
                gallery?: {
                    alt: string;
                    category?: string | null;
                    details?: string | null;
                    prompt?: string | null;
                    /** @description Absolute URL */
                    src: string;
                    title?: string | null;
                }[];
                /** @description Absolute URL */
                hero_image?: string | null;
                tagline?: string | null;
            } | null;
            /** @description Base model this was fine-tuned from */
            source_model?: string | null;
            summary?: string | null;
        };
        /**
         * ListModelsResponse
         * @description OpenAI-compatible response for listing models.
         */
        ListModelsResponse: {
            data: components["schemas"]["Model"][];
            /** @enum {string} */
            object: "list";
        };
        /** WorkbenchReferencesResolveRequest */
        WorkbenchReferencesResolveRequest: {
            /** @description Input URLs to resolve, such as those a saved form draft holds. */
            urls: string[];
        };
        /**
         * FineTune
         * @description Fine-tune job resource.
         *     This is a simplified view meant for OpenAPI docs; extend as needed to match your views.
         */
        FineTune: {
            /** @description Canonical name of the base model */
            base_model?: string;
            /**
             * Format: date_time
             * @description Creation time
             */
            created_at?: string;
            /** @description Fine-tune ID */
            id?: string;
            /** @description Fine-tune name */
            name?: string;
            /** @description Current status of the fine-tune */
            status?: string;
            /**
             * Format: date_time
             * @description Last update time
             */
            updated_at?: string;
        };
        /**
         * CheckpointDeploymentResponse
         * @description Standard wrapper for checkpoint deployment responses.
         */
        CheckpointDeploymentResponse: {
            /** @description ID of the created Baseten deployment. */
            deployment_id?: string;
            /** @description Fine-tune job the deployed checkpoint belongs to. */
            fine_tune?: components["schemas"]["FineTuneRun"];
            /** @description Model record created for this checkpoint deployment. */
            model?: {
                [key: string]: unknown;
            };
            /** @description High-level status string (for example, 'success'). */
            status?: string;
            /** @description Human-readable status message (for example, 'resource_found'). */
            status_message?: string;
        };
        /**
         * CreateCheckpointDeploymentRequest
         * @description Request payload to deploy a specific checkpoint from a fine-tune job.
         */
        CreateCheckpointDeploymentRequest: {
            /**
             * @description Deployment type: 'fast' for faster inference instances, 'normal' for standard instances.
             * @default normal
             * @enum {string}
             */
            deployment_type: "fast" | "normal";
        };
        /**
         * CreateEvaluationRequest
         * @description Request payload to create an evaluation.
         *
         *     The resource path (branch + file path) is specified in the URL after `/evaluations/`,
         *     for example: `POST /api/repos/{namespace}/{repo}/evaluations/main/datasets/training.parquet`.
         */
        CreateEvaluationRequest: {
            /**
             * @description If true, automatically commit the results when the evaluation completes
             * @default false
             */
            auto_commit: boolean;
            /**
             * @description Number of rows to process per inference batch
             * @default 10
             */
            batch_size: number;
            /** @description Commit message used when auto_commit is true */
            commit_message?: string | null;
            /**
             * @description Type of input data
             * @enum {string}
             */
            input_type: "text" | "image" | "video";
            /**
             * @description If true, only evaluate a subset of rows. If false, evaluate all rows.
             * @default false
             */
            is_sample: boolean;
            /**
             * Format: uuid
             * @description ID of the model to run inference with
             */
            model_id: string;
            /** @description Human-readable name for the evaluation */
            name?: string;
            /**
             * @description Type of output produced by the model
             * @enum {string}
             */
            output_type: "text" | "image" | "video" | "embeddings";
            /** @description Prompt template sent to the model. Use `{column_name}` placeholders to inject values from each row. */
            prompt: string;
            /**
             * @description Number of rows to sample when is_sample is true
             * @default 10
             */
            sample_count: number;
            /** @description Branch where evaluation results are committed */
            target_branch?: string;
            /** @description Column where the model output will be written */
            target_column: string;
            /** @description File path for the output data frame */
            target_path?: string;
        };
        /**
         * Evaluation
         * @description An evaluation resource representing a model inference run over a dataset.
         */
        Evaluation: {
            /** Format: date_time */
            cancelled_at?: string | null;
            /** Format: date_time */
            completed_at?: string | null;
            /** @description Completion tokens consumed */
            completion_tokens_used?: number;
            /** @description User who created the evaluation */
            created_by?: {
                id?: string;
                image?: string | null;
                name?: string | null;
                username?: string;
            } | null;
            /**
             * Format: float
             * @description Credits consumed
             */
            credits_used?: number;
            /** @description Error details if status is errored */
            error_message?: string | null;
            /**
             * Format: uuid
             * @description Evaluation ID
             */
            id?: string;
            /** @enum {string} */
            input_type?: "text" | "image" | "video";
            /** Format: date_time */
            inserted_at?: string;
            is_sample?: boolean;
            /** @description Model used for this evaluation */
            model?: {
                [key: string]: unknown;
            } | null;
            /** @description Evaluation name */
            name?: string | null;
            /** @enum {string} */
            output_type?: "text" | "image" | "video" | "embeddings";
            /** @description Processing progress */
            progress?: {
                /** @description Number of rows processed so far */
                processed?: number;
                /** @description Total number of rows to process */
                total?: number;
            };
            /** @description Prompt template used for inference */
            prompt?: string;
            /** @description Prompt tokens consumed */
            prompt_tokens_used?: number;
            repository_id?: string;
            /** @description Source data resource */
            resource?: {
                /** @description Path inside the repository */
                path?: string;
                /** @description Commit ID or version */
                version?: string;
            } | null;
            sample_count?: number;
            /** Format: date_time */
            started_at?: string | null;
            /**
             * @description Current status
             * @enum {string}
             */
            status?: "queued" | "running" | "committing" | "completed" | "errored" | "cancelled";
            target_branch?: string | null;
            target_column?: string | null;
            target_path?: string | null;
            /** @description Total tokens (prompt + completion) */
            tokens_used?: number;
        };
        /**
         * GenerationsFilterValuesResponse
         * @description Distinct values for each requested filter column, keyed by the column name the caller passes back to the list endpoint. `truncated` says the column has more values than the response carries.
         */
        GenerationsFilterValuesResponse: {
            filters: {
                [key: string]: {
                    truncated: boolean;
                    values: string[];
                };
            };
            /** @example success */
            status: string;
            /** @example resource_found */
            status_message: string;
        };
        /**
         * FineTuneRunResponse
         * @description Standard wrapper for fine-tune /run responses.
         */
        FineTuneRunResponse: {
            /** @description Fine-tune job resource as returned by /run */
            fine_tune?: components["schemas"]["FineTuneRun"];
            /** @description High-level status string (for example, 'success'). */
            status?: string;
            /** @description Human-readable status message (for example, 'resource_found'). */
            status_message?: string;
        };
        /**
         * FineTuneListResponse
         * @description Standard wrapper for fine-tune list responses.
         */
        FineTuneListResponse: {
            /** @description List of fine-tune job resources */
            fine_tunes?: components["schemas"]["FineTune"][];
            /** @description High-level status string (for example, 'success'). */
            status?: string;
            /** @description Human-readable status message (for example, 'resource_found'). */
            status_message?: string;
        };
        /** ImageEditRequest */
        ImageEditRequest: {
            /** @description URL of the source image */
            image: string;
            /** @description URL of the mask image */
            mask?: string | null;
            model: string;
            /** @default 1 */
            n: number;
            /** @description Text instruction for the edit */
            prompt: string;
            size?: string | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    "OxenApiWeb.Controllers.ModelController.get_model_response": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Chat completion request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ChatCompletionRequest"];
            };
        };
        responses: {
            /** @description Chat completion */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatCompletionResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.GenerationsController.list_filter_values": {
        parameters: {
            query: {
                /** @description Comma-separated filter columns. Allowed: `repo`, `folder`, `model`, `media_type`, `status`, `user_id` — the same keys the list endpoint filters on. */
                columns: string;
                namespace?: string;
                user_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Filter values */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationsFilterValuesResponse"];
                };
            };
            /** @description Missing, empty, or unknown columns */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.list_for_team": {
        parameters: {
            query?: {
                /** @description Page number (1-indexed) */
                page?: number;
                /** @description Number of items per page */
                page_size?: number;
                /** @description Search across fine-tune name, display name, base model, and repository (case-insensitive substring match). For example: 'qwen', 'ox/Delorean', 'customer-support'. */
                search?: string;
                /** @description Filter by status. One of: created, tokenizing, enqueued, running, completed, stopped, errored, deployed */
                status?: string;
                /** @description Filter by creator username (exact match) */
                created_by?: string;
                /** @description Sort order by creation date: 'newest' (default) or 'oldest' */
                sort?: string;
            };
            header?: never;
            path: {
                /** @description Organization name */
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List fine-tunes response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneListResponse"];
                };
            };
            /** @description Not authenticated or not a member */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Organization not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.GenerationsController.index": {
        parameters: {
            query?: {
                namespace?: string;
                model?: string;
                media_type?: "image" | "video";
                status?: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
                repo?: string;
                folder?: string;
                user_id?: string;
                page?: number;
                page_size?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Generation list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationsListResponse"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.EvaluationController.get_evaluation": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Evaluation ID
                 * @example d0c8585d-1234-5678-abcd-ef0123456789
                 */
                evaluation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Evaluation details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationResponse"];
                };
            };
            /** @description Evaluation not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.run": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run fine-tune response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneRunResponse"];
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.show": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Fine-tune response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneResponse"];
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted fine-tune response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneResponse"];
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        /** @description Fine-tune update request */
        requestBody?: {
            content: {
                "application/json": {
                    /** @description Description of the fine-tune job */
                    description?: string;
                    /** @description Name shown for the fine-tune job */
                    display_name?: string;
                };
            };
        };
        responses: {
            /** @description Updated fine-tune response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneResponse"];
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.estimate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Model ID (UUID) or name */
                id: string;
            };
            cookie?: never;
        };
        /** @description Estimate request */
        requestBody?: {
            content: {
                "application/json": {
                    /** @description Height in pixels of the input image */
                    input_image_height?: number;
                    /** @description Width in pixels of the input image; with input_image_height, prices an image model billed by output size exactly */
                    input_image_width?: number;
                    /** @description Length of the longest input video; prices a video edit, which runs at that length */
                    input_video_seconds?: number;
                    /** @default 1 */
                    num_generations?: number;
                    /** @description The model's request parameters, per its json_request_schema */
                    params?: Record<string, never>;
                };
            };
        };
        responses: {
            /** @description Cost estimate */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        estimate?: {
                            /** @enum {string} */
                            kind?: "exact" | "range" | "rate" | "unknown";
                            label?: string;
                            max_usd?: string | null;
                            min_usd?: string | null;
                            note?: string;
                            rates?: {
                                /** @description The unit: second, credit, 1M input tokens, 1M output tokens */
                                per?: string;
                                /** @description Dollars per unit, as a decimal string */
                                usd?: string;
                            }[];
                        };
                        model?: string;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Model not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelController.edit_image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Image edit request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ImageEditRequest"];
            };
        };
        responses: {
            /** @description Edited images */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImageGenerateResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.show": {
        parameters: {
            query?: {
                /** @description Pass "live" to refresh deployment status from provider before responding */
                deployment_status?: "live";
            };
            header?: never;
            path: {
                /** @description Model ID (UUID) or name */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Model details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model"];
                };
            };
            /** @description Model not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        /** @description Model update params */
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Updated model */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.delete_custom_model": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted model */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model"];
                };
            };
            /** @description Model not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.checkpoints": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Checkpoints list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckpointListResponse"];
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.search": {
        parameters: {
            query: {
                search: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Search results */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListModelsResponse"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.GenerationsController.show": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                generation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Generation details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationsShowResponse"];
                };
            };
            /** @description Generation not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.logs": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Fine-tune logs response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.list_featured": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Featured models */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListModelsResponse"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.QueueController.show": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                generation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Generation details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueGenerationResponse"];
                };
            };
            /** @description Generation not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.QueueController.delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                generation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Generation cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueDeleteResponse"];
                };
            };
            /** @description Generation not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.stop": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Stop fine-tune response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneStopResponse"];
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelController.generate_image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Image generation request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ImageGenerateRequest"];
            };
        };
        responses: {
            /** @description Generated images */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImageGenerateResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Model deactivated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.wake": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Model activated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.create_checkpoint_deployment": {
        parameters: {
            query?: {
                /** @description If true, cleanup the existing deployment and model for this checkpoint before creating a new one. */
                retry?: boolean;
            };
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
                /**
                 * @description Checkpoint step number
                 * @example 100
                 */
                step: number;
            };
            cookie?: never;
        };
        /** @description Deployment configuration */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CreateCheckpointDeploymentRequest"];
            };
        };
        responses: {
            /** @description Deployment created response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckpointDeploymentResponse"];
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.QueueController.retry": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                generation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Retry enqueued */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueRetryResponse"];
                };
            };
            /** @description Generation not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Generation already succeeded */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelController.generate_audio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Audio generation request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AudioGenerateRequest"];
            };
        };
        responses: {
            /** @description Generated audio */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudioGenerateResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.tokenize": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tokenize fine-tune response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.list_favorites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Favorite models */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListModelsResponse"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.update_train_status": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        /** @description Training status update */
        requestBody?: {
            content: {
                "application/json": {
                    /** @description New training status */
                    new_status: string;
                };
            };
        };
        responses: {
            /** @description Training status updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.get_train_status": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Fine-tune ID
                 * @example ft_123
                 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Training status response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Fine-tune not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.WorkbenchReferenceController.resolve": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                namespace: string;
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description URLs to resolve */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["WorkbenchReferencesResolveRequest"];
            };
        };
        responses: {
            /** @description One result per URL, in order */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkbenchReferencesResolveResponse"];
                };
            };
            /** @description `urls` is missing or not an array of strings */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description More than 100 URLs */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.index": {
        parameters: {
            query?: {
                provider_name?: string;
                developer_name?: string;
                action?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Model list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListModelsResponse"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.index": {
        parameters: {
            query?: {
                /** @description Page number (1-indexed) */
                page?: number;
                /** @description Number of items per page */
                page_size?: number;
                /** @description Search across fine-tune name, display name, base model, and repository (case-insensitive substring match). For example: 'qwen', 'ox/Delorean', 'customer-support'. */
                search?: string;
                /** @description Filter by status. One of: created, tokenizing, enqueued, running, completed, stopped, errored, deployed */
                status?: string;
                /** @description Filter by creator username (exact match) */
                created_by?: string;
                /** @description Sort order by creation date: 'newest' (default) or 'oldest' */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List fine-tunes response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneListResponse"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Create fine-tune request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CreateFineTuneRequest"];
            };
        };
        responses: {
            /** @description Create fine-tune response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneResponse"];
                };
            };
            /** @description Invalid fine-tune parameters */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.EvaluationController.create_evaluation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Create evaluation request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CreateEvaluationRequest"];
            };
        };
        responses: {
            /** @description Evaluation created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationResponse"];
                };
            };
            /** @description Invalid parameters */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.QueueController.index": {
        parameters: {
            query?: {
                namespace?: string;
                model?: string;
                media_type?: "image" | "video";
                status?: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
                repo?: string;
                folder?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Generation list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueListResponse"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.QueueController.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Queue request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["QueueCreateRequest"];
            };
        };
        responses: {
            /** @description Generation enqueued */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueCreateResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.list_accessible": {
        parameters: {
            query?: {
                /** @description Page number (1-indexed) */
                page?: number;
                /** @description Number of items per page */
                page_size?: number;
                /** @description Search across fine-tune name, display name, base model, and repository (case-insensitive substring match). For example: 'qwen', 'ox/Delorean', 'customer-support'. */
                search?: string;
                /** @description Filter by status. One of: created, tokenizing, enqueued, running, completed, stopped, errored, deployed */
                status?: string;
                /** @description Filter by creator username (exact match) */
                created_by?: string;
                /** @description Sort order by creation date: 'newest' (default) or 'oldest' */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List fine-tunes response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneListResponse"];
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.FineTuneController.list_for_user": {
        parameters: {
            query?: {
                /** @description Page number (1-indexed) */
                page?: number;
                /** @description Number of items per page */
                page_size?: number;
                /** @description Search across fine-tune name, display name, base model, and repository (case-insensitive substring match). For example: 'qwen', 'ox/Delorean', 'customer-support'. */
                search?: string;
                /** @description Filter by status. One of: created, tokenizing, enqueued, running, completed, stopped, errored, deployed */
                status?: string;
                /** @description Filter by creator username (exact match) */
                created_by?: string;
                /** @description Sort order by creation date: 'newest' (default) or 'oldest' */
                sort?: string;
            };
            header?: never;
            path: {
                /** @description Username */
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List fine-tunes response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FineTuneListResponse"];
                };
            };
            /** @description Not authenticated or not authorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description User not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelController.generate_video": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Video generation request */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["VideoGenerateRequest"];
            };
        };
        responses: {
            /** @description Generated videos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VideoGenerateResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.create_favorite": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Model favorited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model"];
                };
            };
        };
    };
    "OxenApiWeb.Controllers.ModelsController.delete_favorite": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Model unfavorited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Model"];
                };
            };
        };
    };
}
