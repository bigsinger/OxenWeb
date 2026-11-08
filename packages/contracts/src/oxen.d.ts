export interface paths {
    "/api/repos/{namespace}/{repo_name}/branches/{branch_name}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge a commit into a branch
         * @description Merge a client commit into a branch during push. Returns merge commit on success, or original server commit if conflicts occur.
         */
        post: operations["post_api_repos_namespace_repo_name_branches_branch_name_merge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload commits DB
         * @description Upload the commits database tarball to the server during push.
         */
        post: operations["post_api_repos_namespace_repo_name_commits_upload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/data_frames/{compare_id}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Derived Data Frame
         * @description Get the derived diff data frame rows with pagination and optional filtering.
         */
        get: operations["get_api_repos_namespace_repo_name_compare_data_frames_compare_id_diff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits_db": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download commits DB
         * @description Download the commits database as a compressed tarball for cloning.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_db"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/export/download/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export resource as a zip
         * @description Download a directory as a zip archive. Subject to size limits.
         */
        get: operations["get_api_repos_namespace_repo_name_export_download_resource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/upload_chunk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload data chunk
         * @description Upload one chunk of a gzipped archive of commit history, unpacked once every chunk has arrived and the whole payload matches its hash.
         */
        post: operations["post_api_repos_namespace_repo_name_commits_upload_chunk"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get repository stats
         * @description Get the total number of files, the total size of the files, and the number of different file types.
         */
        get: operations["get_api_repos_namespace_repo_name_stats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/{base_head}/file/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get file diff
         * @description Get the detailed diff for a specific file between two revisions.
         */
        get: operations["get_api_repos_namespace_repo_name_compare_base_head_file_resource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/branches/{branch_name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an existing branch
         * @description Get a branch by name, returning its details and current commit.
         */
        get: operations["get_api_repos_namespace_repo_name_branches_branch_name"];
        /**
         * Update a branch to a new commit
         * @description Update a branch to point to a different commit ID.
         */
        put: operations["put_api_repos_namespace_repo_name_branches_branch_name"];
        post?: never;
        /**
         * Delete a branch
         * @description Force delete a branch by name.
         */
        delete: operations["delete_api_repos_namespace_repo_name_branches_branch_name"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/versions/batch-download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Batch download files (Tarball)
         * @description Download multiple files as a gzipped tarball by providing their hashes.
         */
        post: operations["post_api_repos_namespace_repo_name_versions_batch_download"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/data_frames/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get data frame slice
         * @description Get a paginated slice of a tabular data frame with optional filtering and transformations.
         */
        get: operations["get_api_repos_namespace_repo_name_data_frames_resource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/data_frames": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a tabular data frame diff
         * @description Create and cache a tabular diff comparing two data frames with configurable keys and target columns.
         */
        post: operations["post_api_repos_namespace_repo_name_compare_data_frames"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/{commit_id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Notify upload complete
         * @description Notify the server that the commit has finished uploading.
         */
        post: operations["post_api_repos_namespace_repo_name_commits_commit_id_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/merge/{branch}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check workspace mergeability
         * @description Checks if a workspace can be committed and merged onto a branch
         */
        get: operations["get_api_repos_namespace_repo_name_workspaces_workspace_id_merge_branch"];
        put?: never;
        /**
         * Merge workspace into branch
         * @description Commit and merge workspace into the specified branch
         */
        post: operations["post_api_repos_namespace_repo_name_workspaces_workspace_id_merge_branch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/root": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get root commit
         * @description Get the root (initial) commit of the repository, or None if empty.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_root"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List repositories
         * @description List all repositories in a namespace.
         */
        get: operations["get_api_repos_namespace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/data_frames/{compare_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a cached tabular data frame diff
         * @description Retrieve a previously cached tabular diff by its comparison ID.
         */
        get: operations["get_api_repos_namespace_repo_name_compare_data_frames_compare_id"];
        /**
         * Update tabular data frame diff
         * @description Update an existing cached tabular diff comparison with new configuration.
         */
        put: operations["put_api_repos_namespace_repo_name_compare_data_frames_compare_id"];
        post?: never;
        /**
         * Delete DF Diff
         * @description Delete a cached tabular diff comparison by its ID.
         */
        delete: operations["delete_api_repos_namespace_repo_name_compare_data_frames_compare_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/{commit_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get commit
         * @description Get details of a specific commit by its ID.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_commit_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/versions/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download version file
         * @description Download a file by its resource path, with optional image resizing.
         */
        get: operations["get_api_repos_namespace_repo_name_versions_resource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get workspace
         * @description Get an existing workspace by ID
         */
        get: operations["get_api_repos_namespace_repo_name_workspaces_workspace_id"];
        put?: never;
        post?: never;
        /**
         * Delete workspace
         * @description Delete a workspace by ID
         */
        delete: operations["delete_api_repos_namespace_repo_name_workspaces_workspace_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/{commit_or_branch}/commit_entries_db": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download commit entries DB
         * @description Download the commit entries database for a specific commit as a tarball.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_commit_or_branch_commit_entries_db"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/import/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import file from URL
         * @description Import a file from a remote URL and commit it to the repository.
         */
        post: operations["post_api_repos_namespace_repo_name_import_resource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/copy/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Copy a committed file to a new path within the workspace
         * @description Stage a copy of a file from the workspace's base commit at a new path. The copy shares the committed file's content, so nothing is uploaded. A copy with a different extension gets the type and metadata an upload of the same bytes to the new path would.
         */
        post: operations["post_api_repos_namespace_repo_name_workspaces_workspace_id_copy_path"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/versions/uploads/{upload_id}/parts/{part_number}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Upload one part of a version file
         * @description Upload one part of a file. A part may arrive up to `part_window` parts from the earliest part not yet hashed, counting that part, and one further ahead is refused with 429 and Retry-After, as is a part sent again while its first copy is still being stored. Until the upload completes, a part sent again after it was stored is accepted and ignored. Once it completes, any part gets 404, as for an upload that was aborted, so a client that lost the response for the last part begins the upload again, which answers with no parts to send once the file is stored. Each part but the last is exactly the upload's part size. The response for the part that completes the file reports `completed: true`, once the file is verified against its hash and staged in the upload's workspace, if it has one.
         */
        put: operations["put_api_repos_namespace_repo_name_versions_uploads_upload_id_parts_part_number"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload commit
         * @description Upload a commit to a branch on the server. This creates an empty commit. Its merkle tree nodes are uploaded separately through the tree nodes endpoint.
         */
        post: operations["post_api_repos_namespace_repo_name_commits"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/data_frames/from_directory/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create data frame from directory
         * @description Create a data frame by scanning directory contents and commit it to a branch.
         */
        post: operations["post_api_repos_namespace_repo_name_data_frames_from_directory_resource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/history/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List commit history
         * @description List paginated commit history for a revision or file path. Supports revision ranges (base..head) and path-specific history.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_history_resource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/namespaces/{namespace}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get namespace
         * @description Get details of a specific namespace by name.
         */
        get: operations["get_api_namespaces_namespace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/versions/{version_id}/metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get version file metadata
         * @description Get metadata for a specific file version by its hash.
         */
        get: operations["get_api_repos_namespace_repo_name_versions_version_id_metadata"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/import/upload/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload zip archive
         * @description Upload and decompress a zip archive into the repository and commit the contents.
         */
        post: operations["post_api_repos_namespace_repo_name_import_upload_resource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/files/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get file from workspace
         * @description Get a file from a workspace.
         */
        get: operations["get_api_repos_namespace_repo_name_workspaces_workspace_id_files_path"];
        put?: never;
        /**
         * Add files to workspace
         * @description Upload and stage files to a workspace. Accept a multipart with either gzipped or uncompressed file parts. Use the filename from the file part and compute the file hash from the content.
         */
        post: operations["post_api_repos_namespace_repo_name_workspaces_workspace_id_files_path"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/data_frames/schema/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the metadata on a data frame's schema itself — the file-level
         *     counterpart to the per-column metadata endpoint. Staged into the
         *     workspace, so no commit is required.
         * @description Set the metadata on a data frame's schema itself, the HTTP equivalent of `oxen schemas add <path> -m '{...}'`. Staged into the workspace, so no commit is required. Replaces any existing schema metadata wholesale.
         */
        put: operations["put_api_repos_namespace_repo_name_workspaces_workspace_id_data_frames_schema_path"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/missing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List missing commits
         * @description From a list of commit hashes, list the ones not present on the server
         */
        get: operations["get_api_repos_namespace_repo_name_commits_missing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/changes/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List staged changes under a directory in a workspace
         * @description List the staged changes (added, modified, and removed files) under a directory in a workspace. The added, modified, and removed lists are each paginated independently, with the same page and page_size applied to each list.
         */
        get: operations["get_api_repos_namespace_repo_name_workspaces_workspace_id_changes_path"];
        put?: never;
        post?: never;
        /**
         * Unstage a file from the workspace
         * @description Unstage a file from workspace staging
         */
        delete: operations["delete_api_repos_namespace_repo_name_workspaces_workspace_id_changes_path"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/merge/{base_head}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check if branches are mergeable
         * @description Check if two branches can be merged and list any conflicts.
         */
        get: operations["get_api_repos_namespace_repo_name_merge_base_head"];
        put?: never;
        /**
         * Merge branches
         * @description Merge the head branch into the base branch, creating a merge commit.
         */
        post: operations["post_api_repos_namespace_repo_name_merge_base_head"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/missing_files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List missing files from commits
         * @description List files that are referenced in a commit but not present on the server. Accept a commit range.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_missing_files"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/file/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download File
         * @description Download a file from the repository. Supports image resizing and video thumbnail generation via query parameters.
         */
        get: operations["get_api_repos_namespace_repo_name_file_resource"];
        /**
         * Upload files
         * @description Upload files via multipart form and commit them. Use `files[]` for directory uploads, or `file` for a single full-path upload. For backward compatibility, `file` also uploads into the target directory when `{resource}` already resolves to a directory.
         */
        put: operations["put_api_repos_namespace_repo_name_file_resource"];
        post?: never;
        /**
         * Delete file
         * @description Remove a file from the repository. Stage the file as removed to a workspace and commit the removal. Can remove files or directories.
         */
        delete: operations["delete_api_repos_namespace_repo_name_file_resource"];
        options?: never;
        head?: never;
        /**
         * Move/Rename file
         * @description Move or rename a file within the repository and commit the change.
         */
        patch: operations["patch_api_repos_namespace_repo_name_file_resource"];
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List staged changes in a workspace
         * @description List the staged changes (added, modified, and removed files) in a workspace. The added, modified, and removed lists are each paginated independently, with the same page and page_size applied to each list.
         */
        get: operations["get_api_repos_namespace_repo_name_workspaces_workspace_id_changes"];
        put?: never;
        post?: never;
        /**
         * Unstage files
         * @description Unstage files from a workspace. Accepts both files and directories.
         */
        delete: operations["delete_api_repos_namespace_repo_name_workspaces_workspace_id_changes"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Batch upload files (Multipart)
         * @description Upload multiple files via multipart form, identified by their content hashes.
         */
        post: operations["post_api_repos_namespace_repo_name_versions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List all commits
         * @description List all commits in a repository
         */
        get: operations["get_api_repos_namespace_repo_name_commits_all"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/branches/{branch_name}/versions/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get all versions of a file on a branch
         * @description List paginated historical versions of a file across commits on a branch, including schema hash for tabular files.
         */
        get: operations["get_api_repos_namespace_repo_name_branches_branch_name_versions_path"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/version": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check Oxen server status
         * @description Check if the Oxen server is running and responsive.
         */
        get: operations["get_api_version"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Stage files for removal
         * @description Stage files for removal from the repository. Accepts both files and directories.
         */
        delete: operations["delete_api_repos_namespace_repo_name_workspaces_workspace_id_files"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/namespaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List namespaces
         * @description List all namespaces on the server.
         */
        get: operations["get_api_namespaces"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Transfer repository namespace
         * @description Transfer a repository to a different namespace.
         */
        patch: operations["patch_api_repos_namespace_repo_name_transfer"];
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/rename": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Rename a repository
         * @description Record a new name for a repository whose directory does not carry its name. Only a server whose repository UUIDs are assigned by an auth provider accepts it.
         */
        patch: operations["patch_api_repos_namespace_repo_name_rename"];
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List all branches
         * @description List all branches in the repository with their current commit information.
         */
        get: operations["get_api_repos_namespace_repo_name_branches"];
        put?: never;
        /**
         * Create a new branch
         * @description Create a new branch from another branch name or commit ID. Returns existing branch if name already exists.
         */
        post: operations["post_api_repos_namespace_repo_name_branches"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/size": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get repository size
         * @description Get the cached size of the repository in bytes.
         */
        get: operations["get_api_repos_namespace_repo_name_size"];
        put?: never;
        /**
         * Update repository size
         * @description Kick off a recalculation of the repository size. `GET /size` keeps serving the previous figure until the new one lands.
         */
        post: operations["post_api_repos_namespace_repo_name_size"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get repository details
         * @description Get repository details including size and data types from the main branch.
         */
        get: operations["get_api_repos_namespace_repo_name"];
        put?: never;
        post?: never;
        /**
         * Delete repository
         * @description Delete a repository. Deletion runs in the background.
         */
        delete: operations["delete_api_repos_namespace_repo_name"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces/{workspace_id}/data_frames/columns/schema/metadata/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Set the metadata on a single column of a data frame, the HTTP equivalent of `oxen schemas add <path> -c <column> -m '{...}'`. Staged into the workspace, so no commit is required. Replaces that column's existing metadata wholesale. */
        post: operations["post_api_repos_namespace_repo_name_workspaces_workspace_id_data_frames_columns_schema_metadata_path"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/{base_head}/dir_hashes_db": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download dir hashes DB
         * @description Download directory hashes database for a commit range as a tarball.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_base_head_dir_hashes_db"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/commits/{commit_or_branch}/parents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a commit's parents
         * @description Get the parent commits of a specific commit or the tip of a branch.
         */
        get: operations["get_api_repos_namespace_repo_name_commits_commit_or_branch_parents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List workspaces
         * @description List workspaces in the repository
         */
        get: operations["get_api_repos_namespace_repo_name_workspaces"];
        /**
         * Get or create workspace
         * @description Create a workspace. If the workspace exists, return it
         */
        put: operations["put_api_repos_namespace_repo_name_workspaces"];
        post?: never;
        /**
         * Clear workspaces for repo
         * @description Deletes all workspaces for the repo
         */
        delete: operations["delete_api_repos_namespace_repo_name_workspaces"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/versions/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Begin a version file upload
         * @description Begin uploading a large file in parts. A file may be at most 1 TiB, a provisional limit. The response's `file` is `awaiting_parts`, with the upload id, the size of every part but the last, the number of parts, and how many parts the upload accepts at once, starting at the first part not yet hashed. When the request gives a destination, a workspace and a path, the file is staged there once its last part arrives. When the store already has the file, `file` is `already_stored`: no parts are needed, and the file is staged at the destination, if one was given. A client whose upload completed without a response, or failed to stage, begins it again.
         */
        post: operations["post_api_repos_namespace_repo_name_versions_uploads"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/dir/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List directory contents
         * @description List paginated contents of a directory at a specific revision, with optional workspace support.
         */
        get: operations["get_api_repos_namespace_repo_name_dir_resource"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create repository
         * @description Create a new repository, optionally with initial files via JSON or multipart form.
         */
        post: operations["post_api_repos"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/entries/{base_head}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List file and directory entries changed between base and head
         * @description List paginated entries (files and directories) that changed between two revisions with change counts.
         */
        get: operations["get_api_repos_namespace_repo_name_compare_entries_base_head"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/commits/{base_head}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List commits between two revisions
         * @description List commits between a 'base' and 'head' commit. Two dots list what head added; three dots list the commits on either side but not both, each tagged with the side it came from.
         */
        get: operations["get_api_repos_namespace_repo_name_compare_commits_base_head"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/dir_tree/{base_head}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get diff tree
         * @description Get a tree structure of directories that have changed between two revisions.
         */
        get: operations["get_api_repos_namespace_repo_name_compare_dir_tree_base_head"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/compare/entries/{base_head}/dir/{dir}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List changed files
         * @description List the files and sub-directories within a directory that have changed within a provided commit range.
         */
        get: operations["get_api_repos_namespace_repo_name_compare_entries_base_head_dir_dir"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/data_frames/index/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start data frame indexing
         * @description Start indexing a tabular file for queryable access. Creates a workspace if the file is not already indexed.
         */
        post: operations["post_api_repos_namespace_repo_name_data_frames_index_resource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/repos/{namespace}/{repo_name}/meta/{resource}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get file metadata
         * @description Get metadata for a file or directory entry, with optional workspace support.
         */
        get: operations["get_api_repos_namespace_repo_name_meta_resource"];
        put?: never;
        /**
         * Update file metadata
         * @description Update metadata for a file version in the version store.
         */
        post: operations["post_api_repos_namespace_repo_name_meta_resource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        User: {
            email: string;
            name: string;
        };
        /**
         * @example {
         *       "can_merge": true,
         *       "status": "success",
         *       "status_message": "commit_validation_success"
         *     }
         */
        CommitTreeValidationResponse: components["schemas"]["StatusMessage"] & {
            can_merge: boolean;
        };
        DataFrameSize: {
            height: number;
            width: number;
        };
        /** @description The answer to `POST /versions/uploads`. */
        VersionUploadResponse: components["schemas"]["StatusMessage"] & components["schemas"]["VersionUploadStart"];
        /**
         * @example {
         *       "repositories": [
         *         {
         *           "name": "data-fields",
         *           "namespace": "ox"
         *         },
         *         {
         *           "name": "my-corn-pics",
         *           "namespace": "bessie"
         *         }
         *       ],
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        ListRepositoryResponse: components["schemas"]["StatusMessage"] & {
            /**
             * @example [
             *       {
             *         "name": "data-fields",
             *         "namespace": "ox"
             *       },
             *       {
             *         "name": "my-corn-pics",
             *         "namespace": "bessie"
             *       }
             *     ]
             */
            repositories: components["schemas"]["RepositoryListView"][];
        };
        FileUpload: {
            /** Format: binary */
            file: string;
        };
        CompareEntriesResponse: components["schemas"]["StatusMessage"] & components["schemas"]["Pagination"] & {
            compare: components["schemas"]["CompareEntries"];
        };
        /** @description The namespace a repository is being transferred into. */
        TransferNamespaceRequest: {
            /**
             * @description The destination namespace, as addressed on disk. A UUID where a control plane owns
             *     namespaces, and the namespace's name where the server owns its own.
             */
            namespace: string;
            /**
             * @description What the destination namespace is called, where `namespace` addresses it by UUID instead.
             *     Recorded as the repository's namespace hint, and refused when it is not a valid namespace
             *     name. A server that owns its own namespaces takes the name from the `namespace` position and
             *     ignores this.
             */
            namespace_name?: string | null;
        };
        PreviousField: {
            dtype: string;
            metadata?: unknown;
            name: string;
        };
        /** @enum {string} */
        ImgColorSpace: "RGB" | "RGBA" | "Grayscale" | "GrayscaleAlpha" | "Rgb16" | "Rgba16" | "Grayscale16" | "GrayscaleAlpha16" | "Rgb32F" | "Rgba32F" | "Unknown";
        MetadataImageImpl: {
            color_space?: components["schemas"]["ImgColorSpace"] | null;
            /** Format: int32 */
            height: number;
            /** Format: int32 */
            width: number;
        };
        /**
         * @example {
         *       "commit": {
         *         "author": "ox",
         *         "email": "ox@example.com",
         *         "id": "a1b2c3d4e5f67890abcdef1234567890",
         *         "message": "Initial empty repository commit.",
         *         "parent_ids": [],
         *         "timestamp": "2025-01-01T10:00:00Z"
         *       },
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        RootCommitResponse: components["schemas"]["StatusMessage"] & {
            commit?: components["schemas"]["Commit"] | null;
        };
        ListCommitEntryResponse: components["schemas"]["StatusMessage"] & {
            entries: components["schemas"]["CommitEntry"][];
        };
        NamespaceView: {
            namespace: string;
        };
        /**
         * @description One page of the commits that changed a file or directory, newest first. The history is not
         *     counted, so the page reports whether a later one exists rather than how many there are.
         * @example {
         *       "commits": [
         *         {
         *           "author": "ox",
         *           "email": "ox@example.com",
         *           "id": "a1b2c3d4e5f67890abcdef1234567890",
         *           "message": "Relabel the validation images.",
         *           "parent_ids": [
         *             "f1e2d3c4b5a67890fedcba9876543210"
         *           ],
         *           "timestamp": "2025-01-01T10:00:00Z"
         *         }
         *       ],
         *       "has_more": true,
         *       "page_number": 1,
         *       "page_size": 10,
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        PathHistoryPage: components["schemas"]["StatusMessage"] & {
            commits: components["schemas"]["Commit"][];
            has_more: boolean;
            page_number: number;
            page_size: number;
        };
        EMetadataEntryResponseView: components["schemas"]["StatusMessage"] & {
            entry: components["schemas"]["EMetadataEntry"];
        };
        /**
         * ImportFileBody
         * @description Body for importing a file from a URL
         * @example {
         *       "auth": "Bearer <token>",
         *       "download_url": "https://example.com/datasets/data.csv",
         *       "email": "ox@oxen.ai",
         *       "filename": "data.csv",
         *       "message": "Import dataset",
         *       "name": "ox"
         *     }
         */
        ImportFileBody: {
            /** @example Bearer <token> */
            auth?: string | null;
            /** @example https://example.com/datasets/data.csv */
            download_url: string;
            /** @example ox@oxen.ai */
            email?: string | null;
            /** @example data.csv */
            filename?: string | null;
            /** @example Import dataset */
            message?: string | null;
            /** @example ox */
            name?: string | null;
        };
        /**
         * @example {
         *       "data_size": 524288000,
         *       "data_type": "image",
         *       "file_count": 500
         *     }
         */
        DataTypeView: {
            /** Format: int64 */
            data_size: number;
            data_type: components["schemas"]["EntryDataType"];
            file_count: number;
        };
        TabularCompareResourceBody: {
            path: string;
            version: string;
        };
        CompareTabularResponse: components["schemas"]["StatusMessage"] & {
            dfs: components["schemas"]["CompareTabular"];
            messages: components["schemas"]["OxenMessage"][];
        };
        MerkleHashes: {
            hashes: components["schemas"]["MerkleHash"][];
        };
        NamespaceResponse: components["schemas"]["StatusMessage"] & {
            namespace: components["schemas"]["Namespace"];
        };
        MetadataDirImpl: {
            data_types: components["schemas"]["DataTypeCount"][];
        };
        /**
         * @example {
         *       "name": "my-farm-data",
         *       "namespace": "bessie"
         *     }
         */
        RepositoryListView: {
            min_version?: string | null;
            name: string;
            namespace: string;
        };
        JsonDataFrameView: components["schemas"]["DFOptsView"] & {
            data: unknown;
            pagination: components["schemas"]["Pagination"];
            schema: components["schemas"]["Schema"];
            size: components["schemas"]["DataFrameSize"];
        };
        DirDiffSummaryImpl: {
            file_counts: components["schemas"]["AddRemoveModifyCounts"];
        };
        PaginatedDirEntries: {
            dir?: components["schemas"]["EMetadataEntry"] | null;
            entries: components["schemas"]["EMetadataEntry"][];
            metadata?: components["schemas"]["MetadataDir"] | null;
            page_number: number;
            page_size: number;
            resource?: components["schemas"]["ResourceVersion"] | null;
            total_entries: number;
            total_pages: number;
        };
        /**
         * @description Body of `POST /versions/uploads`: the file's hash and size, and where to stage it once it
         *     completes.
         */
        BeginVersionUploadRequest: {
            destination?: components["schemas"]["WorkspaceDestination"] | null;
            hash: string;
            /** Format: int64 */
            size: number;
        };
        CompareSourceSchemas: {
            left: components["schemas"]["Schema"];
            right: components["schemas"]["Schema"];
        };
        MetadataAudioImpl: {
            num_channels: number;
            /** Format: double */
            num_seconds: number;
            sample_rate: number;
        };
        /**
         * @example {
         *       "namespaces": [
         *         {
         *           "name": "my_namespace"
         *         },
         *         {
         *           "name": "oxen"
         *         }
         *       ],
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        ListNamespacesResponse: components["schemas"]["StatusMessage"] & {
            namespaces: components["schemas"]["NamespaceView"][];
        };
        NewWorkspace: {
            branch_name: string;
            entity_type?: string | null;
            force?: boolean | null;
            name?: string | null;
            resource_path?: string | null;
            workspace_id: string;
        };
        WorkspaceResponseView: components["schemas"]["StatusMessage"] & {
            workspace: components["schemas"]["WorkspaceResponse"];
        };
        MergeConflictFile: {
            path: string;
        };
        /**
         * @description A commit history response: a revision's history carries its totals, and a file or directory's
         *     history reports whether a later page exists.
         */
        CommitHistory: components["schemas"]["PaginatedCommits"] | components["schemas"]["PathHistoryPage"];
        CompareEntryResponse: components["schemas"]["StatusMessage"] & {
            compare: components["schemas"]["DiffEntry"];
        };
        /** @enum {string} */
        MessageLevel: "Info" | "Warning" | "Error";
        /**
         * @description Which side of a comparison a commit came from, mirroring the markers git's
         *     `log --left-right base...head` prints.
         * @enum {string}
         */
        CommitSide: "base" | "head";
        /** @enum {string} */
        ChangeType: "Added" | "Removed" | "Modified" | "Unchanged";
        /** @description The workspace and path to stage an uploaded file at. */
        WorkspaceDestination: {
            path: string;
            workspace_id: string;
        };
        CompareTabular: {
            display?: components["schemas"]["TabularCompareTargetBody"][] | null;
            dupes: components["schemas"]["CompareDupes"];
            keys?: components["schemas"]["TabularCompareFieldBody"][] | null;
            schema_diff?: components["schemas"]["CompareSchemaDiff"] | null;
            source_schemas: components["schemas"]["CompareSourceSchemas"];
            summary?: components["schemas"]["CompareSummary"] | null;
            targets?: components["schemas"]["TabularCompareTargetBody"][] | null;
        };
        MergeResult: {
            base: components["schemas"]["Commit"];
            head: components["schemas"]["Commit"];
            merge: components["schemas"]["Commit"];
        };
        BranchNewFromBranchName: {
            from_name: string;
            new_name: string;
        };
        CompareSchemaColumn: {
            dtype: string;
            key: string;
            name: string;
        };
        Schema: {
            fields: components["schemas"]["Field"][];
            hash: string;
            metadata?: unknown;
        };
        /** @description JSON text content. The fixed server uses custom Serde serialize_str/visit_str. Upload binary files through the documented multipart file endpoint. */
        FileContents: string;
        /** @description A part stored. `completed` is true for the part that completed the upload. */
        VersionUploadPartResponse: components["schemas"]["StatusMessage"] & {
            completed: boolean;
        };
        ParseResourceResponse: components["schemas"]["StatusMessage"] & {
            resource: components["schemas"]["ParsedResourceView"];
        };
        /**
         * ZipUploadBody
         * @description Body for uploading a zip archive via multipart/form-data
         * @example {
         *       "commit_message": "Importing full archive of grazing data",
         *       "email": "ox@oxen.ai",
         *       "file": "<binary zip data>",
         *       "name": "ox"
         *     }
         */
        ZipUploadBody: {
            /** @example Importing dataset archive */
            commit_message?: string | null;
            /** @example ox@oxen.ai */
            email?: string | null;
            /** Format: binary */
            file: string;
            /** @example ox */
            name?: string | null;
        };
        TabularDiffSummary: {
            summary: components["schemas"]["TabularDiffSummaryImpl"];
        };
        /** @enum {string} */
        EntryDataType: "dir" | "text" | "image" | "video" | "audio" | "tabular" | "binary";
        CommitEntryVersion: {
            commit: components["schemas"]["Commit"];
            resource: components["schemas"]["ResourceVersion"];
            schema_hash?: string | null;
        };
        ListBranchesResponse: components["schemas"]["StatusMessage"] & {
            branches: components["schemas"]["Branch"][];
        };
        Changes: {
            previous?: components["schemas"]["PreviousField"] | null;
            status: string;
        };
        Branch: {
            commit_id: string;
            name: string;
        };
        /**
         * @description A repository's size in bytes together with the state of the calculation behind it. The figure is
         *     the last one a pass completed, or zero when none has.
         */
        RepoSizeFile: {
            /** Format: int64 */
            size: number;
            status: components["schemas"]["SizeStatus"];
        };
        MetadataTextImpl: {
            num_chars: number;
            num_lines: number;
        };
        TabularDiffView: {
            tabular: components["schemas"]["TabularDiffViewImpl"];
        };
        /**
         * @description Used to send workspace state across the wire. The `Workspace`'s other fields (like
         *     `LocalRepository`) would bloat the response and leak internal state.
         */
        WorkspaceView: {
            commit: components["schemas"]["Commit"];
            /**
             * Format: date-time
             * @description `None` for a workspace created before the server recorded creation time.
             */
            created_at?: string | null;
            id: string;
            name?: string | null;
        };
        GenericMetadata: components["schemas"]["MetadataDir"] | components["schemas"]["MetadataText"] | components["schemas"]["MetadataImage"] | components["schemas"]["MetadataVideo"] | components["schemas"]["MetadataAudio"] | components["schemas"]["MetadataTabular"];
        /**
         * @description Represents a file or directory entry at a specific commit.
         *
         *     `Hash` and `Eq` are based on the content hash field, so `HashSet<CommitEntry>`
         *     deduplicates by file content. This is used during fetch and push to avoid
         *     transferring the same content twice.
         */
        CommitEntry: {
            commit_id: string;
            hash: string;
            /** Format: int32 */
            last_modified_nanoseconds: number;
            /** Format: int64 */
            last_modified_seconds: number;
            /** Format: int64 */
            num_bytes: number;
            path: string;
        };
        /**
         * FileUploadBody
         * @description Multipart form for uploading files. Use `file` for a single full-path upload, or `files[]` for uploading one or more files into a directory.
         * @example {
         *       "email": "bessie@oxen.ai",
         *       "files[]": [
         *         "<binary data>"
         *       ],
         *       "message": "Adding a picture of a cow",
         *       "name": "bessie"
         *     }
         */
        FileUploadBody: {
            /** @example bessie@oxen.ai */
            email?: string | null;
            /**
             * Format: binary
             * @deprecated
             * @description Deprecated: use `files[]` instead.
             */
            file?: string | null;
            files: string[];
            /** @example Adding a new image to the training set */
            message?: string | null;
            /** @example bessie */
            name?: string | null;
        };
        NewColumn: {
            data_type: string;
            name: string;
        };
        Namespace: {
            name: string;
            /** Format: double */
            storage_usage_gb: number;
        };
        VersionFile: {
            hash: string;
            /** Format: int64 */
            size: number;
        };
        AddRemoveModifyCounts: {
            added: number;
            modified: number;
            removed: number;
        };
        /**
         * @example {
         *       "repository": {
         *         "data_size": 1074288000,
         *         "data_types": [
         *           {
         *             "data_size": 524288000,
         *             "data_type": "image",
         *             "file_count": 500
         *           },
         *           {
         *             "data_size": 550000000,
         *             "data_type": "tabular",
         *             "file_count": 5
         *           }
         *         ]
         *       },
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        RepositoryStatsResponse: components["schemas"]["StatusMessage"] & {
            repository: components["schemas"]["RepositoryStatsView"];
        };
        DirDiff: components["schemas"]["DirDiffSummary"];
        /**
         * @example {
         *       "repository": {
         *         "data_types": [
         *           {
         *             "count": 1000,
         *             "data_type": "image"
         *           },
         *           {
         *             "count": 5,
         *             "data_type": "tabular"
         *           }
         *         ],
         *         "is_empty": false,
         *         "name": "my-corn-pics",
         *         "namespace": "bessie",
         *         "size": 1074288000
         *       },
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        RepositoryDataTypesResponse: {
            repository: components["schemas"]["RepositoryDataTypesView"];
            status: string;
            status_message: string;
        };
        /**
         * @example {
         *       "stats": {
         *         "commit": {
         *           "author": "ox",
         *           "email": "ox@example.com",
         *           "id": "a1b2c3d4e5f67890abcdef1234567890",
         *           "message": "Refactor data loading pipeline.",
         *           "parent_ids": [
         *             "f1e2d3c4b5a67890fedcba9876543210"
         *           ],
         *           "timestamp": "2025-01-01T10:00:00Z"
         *         },
         *         "num_entries": 12000,
         *         "num_synced_files": 11950
         *       },
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        CommitStatsResponse: components["schemas"]["StatusMessage"] & {
            stats: components["schemas"]["CommitStats"];
        };
        /** @description Only used between client and server for creating a new remote repository. */
        RepoNew: {
            description?: string | null;
            files?: components["schemas"]["FileNew"][] | null;
            host?: string | null;
            is_public?: boolean | null;
            /**
             * @description The name of the repository. When cloned locally, this is the name of the directory.
             *     This name uniquely identifies it in the namespace.
             */
            name: string;
            /**
             * @description The namespace that the repository lives in: dictates application-level repository ownership.
             *     A namespace can be e.g. a user, a team, or an entire organization. Namespaces must be unique.
             */
            namespace: string;
            /**
             * @description What the namespace is called, where `namespace` addresses it by UUID instead. Recorded as a
             *     hint beside the identity, ignored by a server that owns its own namespaces, and refused when
             *     it is not a valid namespace name.
             */
            namespace_name?: string | null;
            /**
             * @description What the repository is called, where `name` addresses it by UUID instead. Recorded as a hint
             *     beside the identity, ignored by a server that owns its own namespaces, and refused when it
             *     is not a valid repository name.
             */
            repo_name?: string | null;
            /**
             * Format: uuid
             * @description The immutable UUID to address the new repo's storage by. Supplied by an external control
             *     plane that owns repository identity; `None` leaves the choice to the server.
             */
            repo_uuid?: string | null;
            root_commit?: components["schemas"]["Commit"] | null;
            scheme?: string | null;
            storage_kind?: components["schemas"]["StorageKind"] | null;
        };
        TabularDiffSummaryImpl: {
            num_added_cols: number;
            num_added_rows: number;
            num_removed_cols: number;
            num_removed_rows: number;
            schema_has_changed: boolean;
        };
        RemoteStagedStatus: {
            added_dirs: components["schemas"]["SummarizedStagedDirStats"];
            added_files: components["schemas"]["PaginatedDirEntries"];
            modified_files: components["schemas"]["PaginatedDirEntries"];
            removed_files: components["schemas"]["PaginatedDirEntries"];
        };
        /**
         * @example {
         *       "commits": [
         *         {
         *           "author": "ox",
         *           "email": "ox@example.com",
         *           "id": "a1b2c3d4e5f67890abcdef1234567890",
         *           "message": "Refactor data loading pipeline.",
         *           "parent_ids": [
         *             "f1e2d3c4b5a67890fedcba9876543210"
         *           ],
         *           "timestamp": "2025-01-01T10:00:00Z"
         *         },
         *         {
         *           "author": "bessie",
         *           "email": "bessie@example.com",
         *           "id": "b0a9f8e7d6c543210fedcba987654321",
         *           "message": "Update ImageNet-1k labels.",
         *           "parent_ids": [
         *             "a1b2c3d4e5f67890abcdef1234567890"
         *           ],
         *           "timestamp": "2025-01-02T11:00:00Z"
         *         }
         *       ],
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        ListCommitResponse: components["schemas"]["StatusMessage"] & {
            commits: components["schemas"]["Commit"][];
        };
        WorkspaceMetadataEntry: {
            changes?: components["schemas"]["WorkspaceChanges"] | null;
            children?: components["schemas"]["WorkspaceMetadataEntry"][] | null;
            data_type: components["schemas"]["EntryDataType"];
            extension: string;
            filename: string;
            hash: string;
            is_dir: boolean;
            is_queryable?: boolean | null;
            latest_commit?: components["schemas"]["Commit"] | null;
            metadata?: components["schemas"]["GenericMetadata"] | null;
            mime_type: string;
            resource?: components["schemas"]["ParsedResourceView"] | null;
            /** Format: int64 */
            size: number;
        };
        EMetadataEntry: components["schemas"]["MetadataEntry"] | components["schemas"]["WorkspaceMetadataEntry"];
        /** @enum {string} */
        SizeStatus: "pending" | "done" | "error";
        DiffEntry: {
            base_entry?: components["schemas"]["MetadataEntry"] | null;
            base_resource?: components["schemas"]["ParsedResourceView"] | null;
            data_type: components["schemas"]["EntryDataType"];
            diff?: components["schemas"]["GenericDiff"] | null;
            diff_summary?: components["schemas"]["GenericDiffSummary"] | null;
            filename: string;
            head_entry?: components["schemas"]["MetadataEntry"] | null;
            head_resource?: components["schemas"]["ParsedResourceView"] | null;
            is_dir: boolean;
            /** Format: int64 */
            size: number;
            status: string;
        };
        DFOptsView: {
            opts: components["schemas"]["DFOptView"][];
        };
        PaginatedEntryVersions: components["schemas"]["Pagination"] & {
            versions: components["schemas"]["CommitEntryVersion"][];
        };
        /**
         * @description Storage backend kind. Serializes as `"local"` / `"s3"` on the wire and on disk.
         * @enum {string}
         */
        StorageKind: "local" | "s3";
        BranchRemoteMerge: {
            client_commit_id: string;
            server_commit_id: string;
        };
        MetadataDir: {
            dir: components["schemas"]["MetadataDirImpl"];
        };
        DirTreeDiffResponse: components["schemas"]["StatusMessage"] & {
            dirs: components["schemas"]["DirDiffTreeSummary"][];
        };
        TabularCompareTargetBody: {
            compare_method?: string | null;
            left?: string | null;
            right?: string | null;
        };
        /**
         * @example {
         *       "author": "ox",
         *       "email": "ox@example.com",
         *       "id": "a1b2c3d4e5f67890abcdef1234567890",
         *       "message": "Refactor data loading pipeline.",
         *       "parent_ids": [
         *         "f1e2d3c4b5a67890fedcba9876543210"
         *       ],
         *       "timestamp": "2025-01-01T10:00:00Z"
         *     }
         */
        Commit: {
            author: string;
            email: string;
            id: string;
            message: string;
            parent_ids: string[];
            /** Format: date-time */
            timestamp: string;
        };
        GenericDiffSummary: components["schemas"]["DirDiffSummary"] | components["schemas"]["TabularDiffWrapper"];
        /**
         * @example {
         *       "data_size": 1074288000,
         *       "data_types": [
         *         {
         *           "data_size": 524288000,
         *           "data_type": "image",
         *           "file_count": 500
         *         },
         *         {
         *           "data_size": 550000000,
         *           "data_type": "tabular",
         *           "file_count": 5
         *         }
         *       ]
         *     }
         */
        RepositoryStatsView: {
            /** Format: int64 */
            data_size: number;
            data_types: components["schemas"]["DataTypeView"][];
        };
        /**
         * @example {
         *       "commit": {
         *         "author": "ox",
         *         "email": "ox@example.com",
         *         "id": "a1b2c3d4e5f67890abcdef1234567890",
         *         "message": "Refactor data loading pipeline.",
         *         "parent_ids": [
         *           "f1e2d3c4b5a67890fedcba9876543210"
         *         ],
         *         "timestamp": "2025-01-01T10:00:00Z"
         *       },
         *       "num_entries": 12000,
         *       "num_synced_files": 11950
         *     }
         */
        CommitStats: {
            commit: components["schemas"]["Commit"];
            num_entries: number;
            num_synced_files: number;
        };
        ErrorFilesResponse: components["schemas"]["StatusMessage"] & {
            err_files?: components["schemas"]["ErrorFileInfo"][];
        };
        CompareEntries: {
            base_commit: components["schemas"]["Commit"];
            counts: components["schemas"]["AddRemoveModifyCounts"];
            entries: components["schemas"]["DiffEntry"][];
            head_commit: components["schemas"]["Commit"];
            self?: components["schemas"]["DiffEntry"] | null;
        };
        /**
         * @description `deny_unknown_fields` is the discriminator for the untagged `EMetadataEntry` enum:
         *     payloads with a `changes` field (i.e. `WorkspaceMetadataEntry`) fail to deserialize here
         *     and fall through to the workspace variant.
         */
        MetadataEntry: {
            children?: components["schemas"]["MetadataEntry"][] | null;
            data_type: components["schemas"]["EntryDataType"];
            extension: string;
            filename: string;
            hash: string;
            is_dir: boolean;
            is_queryable?: boolean | null;
            latest_commit?: components["schemas"]["Commit"] | null;
            metadata?: components["schemas"]["GenericMetadata"] | null;
            mime_type: string;
            resource?: components["schemas"]["ParsedResourceView"] | null;
            /** Format: int64 */
            size: number;
        };
        CompareCommitsResponse: components["schemas"]["StatusMessage"] & components["schemas"]["Pagination"] & {
            compare: components["schemas"]["CompareCommits"];
        };
        /** @enum {string} */
        DFResourceType: "compare" | "diff" | "query";
        JsonDataFrameViewResponse: components["schemas"]["StatusMessage"] & {
            commit?: components["schemas"]["Commit"] | null;
            data_frame: components["schemas"]["JsonDataFrameViews"];
            derived_resource?: components["schemas"]["DerivedDFResource"] | null;
            resource?: components["schemas"]["ResourceVersion"] | null;
        };
        /** @description Where a file stands once its upload starts, in the response's `file` field. */
        VersionUploadStart: {
            /** @enum {string} */
            file: "awaiting_parts";
            /** Format: int64 */
            num_parts: number;
            /** Format: int64 */
            part_size: number;
            /**
             * Format: int64
             * @description How many consecutive parts the upload accepts at once, starting at the first part not
             *     yet hashed. A part past them gets 429, so a client sending parts in order keeps at most
             *     this many in flight.
             */
            part_window: number;
            upload_id: string;
        } | {
            /** @enum {string} */
            file: "already_stored";
        };
        MetadataTabular: {
            tabular: components["schemas"]["MetadataTabularImpl"];
        };
        MergeSuccessResponse: components["schemas"]["StatusMessage"] & {
            commits: components["schemas"]["MergeResult"];
        };
        DerivedDFResource: {
            path: string;
            resource_id: string;
            resource_type: components["schemas"]["DFResourceType"];
        };
        BranchResponse: components["schemas"]["StatusMessage"] & {
            branch: components["schemas"]["Branch"];
        };
        TabularDiffViewImpl: components["schemas"]["TabularDiffSummary"] & {
            added_cols?: components["schemas"]["JsonDataFrame"] | null;
            added_cols_view?: components["schemas"]["JsonDataFrameView"] | null;
            added_rows?: components["schemas"]["JsonDataFrame"] | null;
            added_rows_view?: components["schemas"]["JsonDataFrameView"] | null;
            base_schema?: components["schemas"]["Schema"] | null;
            head_schema?: components["schemas"]["Schema"] | null;
            removed_cols?: components["schemas"]["JsonDataFrame"] | null;
            removed_cols_view?: components["schemas"]["JsonDataFrameView"] | null;
            removed_rows?: components["schemas"]["JsonDataFrame"] | null;
            removed_rows_view?: components["schemas"]["JsonDataFrameView"] | null;
        };
        PaginatedEntryVersionsResponse: components["schemas"]["StatusMessage"] & components["schemas"]["PaginatedEntryVersions"] & {
            branch: components["schemas"]["Branch"];
            path: string;
        };
        /** @description NewCommitBody is used to parse the json into a Commit from the API */
        NewCommitBody: {
            author: string;
            email: string;
            message: string;
        };
        ResourceVersion: {
            path: string;
            version: string;
        };
        ErrorFileInfo: {
            error: string;
            hash: string;
            path?: string | null;
        };
        ListWorkspaceResponseView: components["schemas"]["StatusMessage"] & {
            workspaces: components["schemas"]["WorkspaceResponse"][];
        };
        /**
         * @example {
         *       "latest_commit": {
         *         "author": "ox",
         *         "email": "ox@example.com",
         *         "id": "a1b2c3d4e5f67890abcdef1234567890",
         *         "message": "Initial dataset import.",
         *         "parent_ids": [
         *           "f1e2d3c4b5a67890fedcba9876543210"
         *         ],
         *         "timestamp": "2025-01-01T10:00:00Z"
         *       },
         *       "name": "ImageNet-1k",
         *       "namespace": "ox",
         *       "storage_kind": "s3"
         *     }
         */
        RepositoryCreationView: {
            latest_commit?: components["schemas"]["Commit"] | null;
            min_version?: string | null;
            name: string;
            namespace: string;
            /**
             * Format: uuid
             * @description The immutable UUID this repo's storage is addressed by. `None` for a repository whose
             *     identity backfill has not run.
             */
            repo_uuid?: string | null;
            storage_kind: components["schemas"]["StorageKind"];
        };
        CompareSummary: {
            modifications: components["schemas"]["CompareTabularMods"];
            schema: components["schemas"]["Schema"];
        };
        /** @description External (view) model that is returned to the client with fewer fields. */
        ParsedResourceView: {
            branch?: components["schemas"]["Branch"] | null;
            commit?: components["schemas"]["Commit"] | null;
            path: string;
            resource: string;
            version: string;
            workspace?: components["schemas"]["WorkspaceView"] | null;
        };
        OxenMessage: {
            description: string;
            level: components["schemas"]["MessageLevel"];
            title: string;
        };
        DFOptView: {
            name: string;
            value: unknown;
        };
        FileNew: {
            contents: components["schemas"]["FileContents"];
            path: string;
            user: components["schemas"]["User"];
        };
        MerkleHash: string;
        WorkspaceChanges: {
            status: components["schemas"]["StagedEntryStatus"];
        };
        DataFrameSchemaSize: {
            schema: components["schemas"]["Schema"];
            size: components["schemas"]["DataFrameSize"];
        };
        FileWithHash: {
            hash: string;
            path: string;
        };
        MergeableResponse: components["schemas"]["StatusMessage"] & components["schemas"]["Mergeable"];
        JsonDataFrameViews: {
            source: components["schemas"]["DataFrameSchemaSize"];
            view: components["schemas"]["JsonDataFrameView"];
        };
        TabularCompareBody: {
            compare: components["schemas"]["TabularCompareTargetBody"][];
            compare_id: string;
            display: components["schemas"]["TabularCompareTargetBody"][];
            keys: components["schemas"]["TabularCompareFieldBody"][];
            left: components["schemas"]["TabularCompareResourceBody"];
            right: components["schemas"]["TabularCompareResourceBody"];
        };
        DirDiffStatus: {
            name: string;
            status: components["schemas"]["DiffEntryStatus"];
        };
        MetadataAudio: {
            audio: components["schemas"]["MetadataAudioImpl"];
        };
        /**
         * @description This is a representation of directories that are staged and we want a top level summary of counts
         *     For example:
         *       annotations/
         *         train/
         *           annotations.csv
         *           one_shot.csv
         *           unstaged.csv
         *         test/
         *           annotations.csv
         *
         *     Would have:
         *         annotations/train/ -> num_staged: 2, total: 3
         *         annotations/test/ -> num_staged: 1, total: 1
         *
         *     Rolled up to:
         *         annotations/ -> num_staged: 3, total: 4
         */
        SummarizedStagedDirStats: {
            num_files_staged: number;
            paths: {
                [key: string]: components["schemas"]["StagedDirStats"][];
            };
            total_files: number;
        };
        MetadataText: {
            text: components["schemas"]["MetadataTextImpl"];
        };
        DirDiffSummary: {
            dir: components["schemas"]["DirDiffSummaryImpl"];
        };
        /** @description The name a repository is being renamed to. */
        RenameRepoRequest: {
            /**
             * @description What the repository is called from now on, recorded as its name hint. Refused when it is not
             *     a valid repository name.
             */
            repo_name: string;
        };
        /**
         * @description A commit in a comparison, tagged with the side it came from. Every commit of a two-dot
         *     comparison is on the head side; a three-dot comparison reports commits from both.
         */
        CompareCommit: components["schemas"]["Commit"] & {
            side: components["schemas"]["CommitSide"];
        };
        StagedDirStats: {
            num_files_staged: number;
            path: string;
            status: components["schemas"]["StagedEntryStatus"];
            total_files: number;
        };
        JsonDataFrame: {
            data: unknown;
            full_size: components["schemas"]["DataFrameSize"];
            schema: components["schemas"]["Schema"];
            view_schema: components["schemas"]["Schema"];
            view_size: components["schemas"]["DataFrameSize"];
        };
        /**
         * @example {
         *       "commit": {
         *         "author": "ox",
         *         "email": "ox@example.com",
         *         "id": "a1b2c3d4e5f67890abcdef1234567890",
         *         "message": "Refactor data loading pipeline.",
         *         "parent_ids": [
         *           "f1e2d3c4b5a67890fedcba9876543210"
         *         ],
         *         "timestamp": "2025-01-01T10:00:00Z"
         *       },
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        CommitResponse: components["schemas"]["StatusMessage"] & {
            commit: components["schemas"]["Commit"];
        };
        /**
         * @example {
         *       "repository": {
         *         "is_empty": false,
         *         "name": "ImageNet-1k",
         *         "namespace": "ox"
         *       },
         *       "status": "success",
         *       "status_message": "resource_found"
         *     }
         */
        RepositoryResponse: {
            repository: components["schemas"]["RepositoryView"];
            status: string;
            status_message: string;
        };
        FromDirectoryRequest: {
            commit_message?: string | null;
            extra_columns?: components["schemas"]["NewColumn"][] | null;
            output_path?: string | null;
            recursive?: boolean | null;
            user_email?: string | null;
            user_name?: string | null;
        };
        ImgResize: {
            /** Format: int32 */
            height?: number | null;
            /** Format: int32 */
            width?: number | null;
        };
        DataTypeCount: {
            count: number;
            data_type: string;
        };
        Mergeable: {
            commits: components["schemas"]["Commit"][];
            conflicts: components["schemas"]["MergeConflictFile"][];
            is_mergeable: boolean;
        };
        UploadVersionFile: {
            /** Format: binary */
            file: string;
        };
        CompareDupes: {
            /** Format: int64 */
            left: number;
            /** Format: int64 */
            right: number;
        };
        TextDiff: {
            filename1?: string | null;
            filename2?: string | null;
            lines: components["schemas"]["LineDiff"][];
        };
        CompareTabularMods: {
            added_rows: number;
            modified_rows: number;
            removed_rows: number;
        };
        FilePathsResponse: components["schemas"]["StatusMessage"] & {
            paths: string[];
        };
        RemoteStagedStatusResponse: components["schemas"]["StatusMessage"] & {
            staged: components["schemas"]["RemoteStagedStatus"];
        };
        RenameRequest: {
            /** @example path/to/new_file.txt */
            new_path: string;
        };
        CompareSchemaDiff: {
            added_cols: components["schemas"]["CompareSchemaColumn"][];
            removed_cols: components["schemas"]["CompareSchemaColumn"][];
        };
        DirDiffTreeSummary: {
            can_display: boolean;
            children: components["schemas"]["DirDiffStatus"][];
            name: string;
            num_subdirs: number;
            status: components["schemas"]["DiffEntryStatus"];
        };
        /**
         * @example {
         *       "branch_count": 3,
         *       "data_types": [
         *         {
         *           "count": 1000,
         *           "data_type": "image"
         *         },
         *         {
         *           "count": 5,
         *           "data_type": "tabular"
         *         }
         *       ],
         *       "is_empty": false,
         *       "name": "my-corn-pics",
         *       "namespace": "bessie",
         *       "size": 1073741824,
         *       "storage_kind": "s3"
         *     }
         */
        RepositoryDataTypesView: components["schemas"]["RepositoryView"] & {
            branch_count?: number;
            data_types: components["schemas"]["DataTypeCount"][];
            default_resource?: components["schemas"]["ParsedResourceView"] | null;
            /** Format: int64 */
            size: number;
        };
        MetadataVideoImpl: {
            height: number;
            /** Format: double */
            num_seconds: number;
            width: number;
        };
        WorkspaceResponse: {
            commit: components["schemas"]["Commit"];
            /**
             * Format: date-time
             * @description `None` for a workspace created before the server recorded creation time.
             */
            created_at?: string | null;
            id: string;
            name?: string | null;
        };
        BranchUpdate: {
            commit_id: string;
        };
        StatusMessage: {
            oxen_version?: string | null;
            status: string;
            status_message: string;
        };
        /**
         * @example {
         *       "is_empty": false,
         *       "name": "ImageNet-1k",
         *       "namespace": "ox",
         *       "storage_kind": "s3"
         *     }
         */
        RepositoryView: {
            is_empty: boolean;
            min_version?: string | null;
            name: string;
            namespace: string;
            /**
             * Format: uuid
             * @description The immutable UUID this repo's storage is addressed by. `None` for a repository whose
             *     identity backfill has not run.
             */
            repo_uuid?: string | null;
            storage_kind: components["schemas"]["StorageKind"];
        };
        VersionFileResponse: components["schemas"]["StatusMessage"] & {
            version: components["schemas"]["VersionFile"];
        };
        MetadataVideo: {
            video: components["schemas"]["MetadataVideoImpl"];
        };
        GenericDiff: components["schemas"]["DirDiff"] | components["schemas"]["TabularDiffView"] | components["schemas"]["TextDiff"];
        TabularCompareFieldBody: {
            alias_as?: string | null;
            compare_method?: string | null;
            left: string;
            right: string;
        };
        /** @enum {string} */
        StagedEntryStatus: "Added" | "Modified" | "Removed" | "Unmodified";
        LineDiff: {
            modification: components["schemas"]["ChangeType"];
            text: string;
        };
        CompareCommits: {
            base_commit: components["schemas"]["Commit"];
            commits: components["schemas"]["CompareCommit"][];
            head_commit: components["schemas"]["Commit"];
        };
        PaginatedDirEntriesResponse: components["schemas"]["StatusMessage"] & components["schemas"]["PaginatedDirEntries"];
        Pagination: {
            page_number: number;
            page_size: number;
            total_entries: number;
            total_pages: number;
        };
        /** @enum {string} */
        DiffEntryStatus: "added" | "modified" | "removed";
        MetadataImage: {
            image: components["schemas"]["MetadataImageImpl"];
        };
        MerkleHashesResponse: components["schemas"]["StatusMessage"] & {
            hashes: components["schemas"]["MerkleHash"][];
        };
        Field: {
            changes?: components["schemas"]["Changes"] | null;
            dtype: string;
            metadata?: unknown;
            name: string;
        };
        /**
         * @example {
         *       "commits": [
         *         {
         *           "author": "ox",
         *           "email": "ox@example.com",
         *           "id": "a1b2c3d4e5f67890abcdef1234567890",
         *           "message": "Refactor data loading pipeline.",
         *           "parent_ids": [
         *             "f1e2d3c4b5a67890fedcba9876543210"
         *           ],
         *           "timestamp": "2025-01-01T10:00:00Z"
         *         }
         *       ],
         *       "page_number": 1,
         *       "page_size": 10,
         *       "status": "success",
         *       "status_message": "resource_found",
         *       "total_entries": 45,
         *       "total_pages": 5
         *     }
         */
        PaginatedCommits: components["schemas"]["StatusMessage"] & components["schemas"]["Pagination"] & {
            commits: components["schemas"]["Commit"][];
        };
        /**
         * @example {
         *       "repository": {
         *         "latest_commit": {
         *           "author": "ox",
         *           "email": "ox@example.com",
         *           "id": "a1b2c3d4e5f678902e41",
         *           "message": "Initial dataset import.",
         *           "parent_ids": [
         *             "f1e2d3c4b5a67890fedc"
         *           ],
         *           "timestamp": "2025-01-01T10:00:00Z"
         *         },
         *         "name": "ImageNet-1k",
         *         "namespace": "ox"
         *       },
         *       "status": "success",
         *       "status_message": "resource_created"
         *     }
         */
        RepositoryCreationResponse: {
            repository: components["schemas"]["RepositoryCreationView"];
            status: string;
            status_message: string;
        };
        /**
         * FileMoveBody
         * @description Body for moving/renaming a file
         * @example {
         *       "email": "bessie@oxen.ai",
         *       "message": "Renamed file to new location",
         *       "name": "bessie",
         *       "new_path": "new/path/to/file.txt"
         *     }
         */
        FileMoveBody: {
            /** @example bessie@oxen.ai */
            email?: string | null;
            /** @example Moved file to new location */
            message?: string | null;
            /** @example bessie */
            name?: string | null;
            /** @example new/path/to/file.txt */
            new_path: string;
        };
        MetadataTabularImpl: {
            height: number;
            schema: components["schemas"]["Schema"];
            width: number;
        };
        TabularDiffWrapper: {
            tabular: components["schemas"]["TabularDiffSummaryImpl"];
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
    post_api_repos_namespace_repo_name_branches_branch_name_merge: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Name of the branch to merge into (the target branch)
                 * @example main
                 */
                branch_name: string;
            };
            cookie?: never;
        };
        /** @description Client and Server commit IDs for performing the merge. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "client_commit_id": "abc1234567890def1234567890fedcba",
                 *       "server_commit_id": "84c76a5b2e9a2637f9091991475c404d"
                 *     }
                 */
                "application/json": components["schemas"]["BranchRemoteMerge"];
            };
        };
        responses: {
            /** @description Merge successful or merge conflicts encountered. Returns the new head commit. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Bad Request (e.g., malformed body) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Branch or Commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_commits_upload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Compressed commit database (tar.gz) */
        requestBody: {
            content: {
                "application/octet-stream": number[];
            };
        };
        responses: {
            /** @description Commits DB uploaded successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
        };
    };
    get_api_repos_namespace_repo_name_compare_data_frames_compare_id_diff: {
        parameters: {
            query?: {
                /** @description Page number for pagination (starts at 1) */
                page?: number;
                /** @description Page size for pagination */
                page_size?: number;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example compare-datasets
                 */
                repo_name: string;
                /**
                 * @description The unique ID of the comparison session
                 * @example uuid-1234
                 */
                compare_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Derived data frame found successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JsonDataFrameViewResponse"];
                };
            };
            /** @description Repository or comparison ID not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_db: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tarball of commits DB */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_export_download_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example Wiki-Text
                 */
                repo_name: string;
                /**
                 * @description Path to directory and branch/commit (e.g. main/data)
                 * @example main/data
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Zip archive of the directory */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/zip": unknown;
                };
            };
            /** @description Download size exceeds limit */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository or resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_commits_upload_chunk: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /** @example a2c3d4e5f67890b1c2d3e4f5a6b7c8d9 */
                hash: string;
                /** @example 1 */
                chunk_num: number;
                /** @example 10 */
                total_chunks: number;
                /** @example 100000000 */
                total_size: number;
            };
            cookie?: never;
        };
        /** @description Chunk of data (binary bytes) */
        requestBody: {
            content: {
                "application/octet-stream": number[];
            };
        };
        responses: {
            /** @description Chunk uploaded successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
        };
    };
    get_api_repos_namespace_repo_name_stats: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Repository statistics */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepositoryStatsResponse"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_compare_base_head_file_resource: {
        parameters: {
            query?: {
                /** @description Page number for pagination (starts at 1) */
                page?: number;
                /** @description Page size for pagination */
                page_size?: number;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example compare-datasets
                 */
                repo_name: string;
                /**
                 * @description The base and head revisions separated by '..'
                 * @example main..feature/add-labels
                 */
                base_head: string;
                /**
                 * @description Path to the file (including branch)
                 * @example data/test/file.txt
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File diff found successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareEntryResponse"];
                };
            };
            /** @description Repository, revision, or file not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_branches_branch_name: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Name of the branch
                 * @example main
                 */
                branch_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Branch found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchResponse"];
                };
            };
            /** @description Branch not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_repos_namespace_repo_name_branches_branch_name: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Name of the branch to update
                 * @example main
                 */
                branch_name: string;
            };
            cookie?: never;
        };
        /** @description The commit ID to update the branch head to. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "commit_id": "84c76a5b2e9a2637f9091991475c404d"
                 *     }
                 */
                "application/json": components["schemas"]["BranchUpdate"];
            };
        };
        responses: {
            /** @description Branch updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Branch or Commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name_branches_branch_name: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Name of the branch to delete
                 * @example development
                 */
                branch_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Branch deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchResponse"];
                };
            };
            /** @description Branch not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_versions_batch_download: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Gzip compressed binary payload containing a line-delimited list of merkle hashes to download */
        requestBody: {
            content: {
                "application/gzip": number[];
            };
        };
        responses: {
            /** @description Tarball of all requested files, gzipped. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/gzip": unknown;
                };
            };
        };
    };
    get_api_repos_namespace_repo_name_data_frames_resource: {
        parameters: {
            query?: {
                columns?: string | null;
                delimiter?: string | null;
                find_embedding_where?: string | null;
                filter?: string | null;
                output?: string | null;
                output_column?: string | null;
                page_size?: number | null;
                page?: number | null;
                row?: number | null;
                randomize?: boolean | null;
                reverse?: boolean | null;
                slice?: string | null;
                sort_by?: string | null;
                sort_by_similarity_to?: string | null;
                sql?: string | null;
                take?: string | null;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Path to the tabular file (including branch/commit info)
                 * @example main/data/labels.csv
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Data frame slice found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JsonDataFrameViewResponse"];
                };
            };
            /** @description File or resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_compare_data_frames: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example compare-datasets
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Tabular comparison configuration (files, revisions, keys, targets) */
        requestBody: {
            content: {
                "application/json": components["schemas"]["TabularCompareBody"];
            };
        };
        responses: {
            /** @description Data frame diff created and cached successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareTabularResponse"];
                };
            };
            /** @description Bad Request (e.g., failed to parse body) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository, revision, or file not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_commits_commit_id_complete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description ID of the commit to complete
                 * @example 84c76a5b2e9a2637f9091991475c404d
                 */
                commit_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Commit push completed successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Repository or commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_workspaces_workspace_id_merge_branch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description ID of the workspace
                 * @example b3f27f05-0955-4076-805f-39575853b27b
                 */
                workspace_id: string;
                /**
                 * @description Target branch name to merge into
                 * @example main
                 */
                branch: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Mergeability status found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MergeableResponse"];
                };
            };
            /** @description Workspace or target branch not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_workspaces_workspace_id_merge_branch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description ID of the workspace
                 * @example b3f27f05-0955-4076-805f-39575853b27b
                 */
                workspace_id: string;
                /**
                 * @description Target branch name to commit to
                 * @example main
                 */
                branch: string;
            };
            cookie?: never;
        };
        /** @description Commit details for the workspace merge. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "author": "bessie",
                 *       "email": "bessie@oxen.ai",
                 *       "message": "Commit changes from bessie_workspace"
                 *     }
                 */
                "application/json": components["schemas"]["NewCommitBody"];
            };
        };
        responses: {
            /** @description Workspace committed successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Invalid request body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace or branch not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Conflict — a staged file also changed on the target branch since the workspace's base commit */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unprocessable Entity — the commit failed for another reason */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Too Many Requests: another commit already holds this commit's id, or another write moved the branch while this commit was being written, so retry after the Retry-After delay */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_root: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Root commit found (None if empty repository) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RootCommitResponse"];
                };
            };
        };
    };
    get_api_repos_namespace: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace to list repositories from
                 * @example ox
                 */
                namespace: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of repositories */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRepositoryResponse"];
                };
            };
            /** @description Namespace is not a single path segment */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Namespace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_compare_data_frames_compare_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example compare-datasets
                 */
                repo_name: string;
                /**
                 * @description The unique ID of the comparison session
                 * @example uuid-1234
                 */
                compare_id: string;
                /**
                 * @description The base and head revisions separated by '..'
                 * @example main..feature/add-labels
                 */
                base_head: string;
            };
            cookie?: never;
        };
        /** @description Tabular comparison information needed to fetch the correct cached diff (files, revisions) */
        requestBody: {
            content: {
                "application/json": components["schemas"]["TabularCompareBody"];
            };
        };
        responses: {
            /** @description Cached data frame diff found successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareTabularResponse"];
                };
            };
            /** @description Cached diff not found for the given ID and entries */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_repos_namespace_repo_name_compare_data_frames_compare_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example compare-datasets
                 */
                repo_name: string;
                /**
                 * @description The unique ID of the comparison session
                 * @example uuid-1234
                 */
                compare_id: string;
            };
            cookie?: never;
        };
        /** @description Updated tabular comparison configuration */
        requestBody: {
            content: {
                "application/json": components["schemas"]["TabularCompareBody"];
            };
        };
        responses: {
            /** @description Data frame diff updated and cached successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareTabularResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Comparison ID, Repository, revision, or file not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name_compare_data_frames_compare_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example compare-datasets
                 */
                repo_name: string;
                /**
                 * @description The unique ID of the comparison session to delete
                 * @example uuid-1234
                 */
                compare_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Data frame diff deleted successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Repository or comparison ID not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_commit_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Hash ID of the commit
                 * @example 84c76a5b2e9a2637f9091991475c404d
                 */
                commit_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Commit */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_versions_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The resource identifier (e.g., 'main/path/to/file.ext' or a commit ID/branch name followed by the file path)
                 * @example main/images/dog_1.jpg
                 */
                resource: string;
                width: number | null;
                height: number | null;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File content returned as a stream. Content-Type matches the file's MIME type (e.g., image/jpeg), or the resized image's MIME type. */
            200: {
                headers: {
                    /** @description The commit ID of the file version */
                    "oxen-revision-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": number[];
                };
            };
            /** @description Repository, commit, or file not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_workspaces_workspace_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description ID of the workspace
                 * @example b3f27f05-0955-4076-805f-39575853b27b
                 */
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Workspace found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceResponseView"];
                };
            };
            /** @description Workspace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name_workspaces_workspace_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description ID of the workspace
                 * @example b3f27f05-0955-4076-805f-39575853b27b
                 */
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Workspace deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceResponseView"];
                };
            };
            /** @description Workspace or Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_commit_or_branch_commit_entries_db: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Commit ID or Branch name
                 * @example main
                 */
                commit_or_branch: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tarball of commit entries DB */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository or commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_import_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example Common-Crawl
                 */
                repo_name: string;
                /**
                 * @description Destination path (including branch)
                 * @example main/data
                 */
                resource: string;
            };
            cookie?: never;
        };
        /** @description Import configuration */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "auth": "Bearer <token>",
                 *       "download_url": "https://example.com/datasets/data.csv",
                 *       "email": "ox@oxen.ai",
                 *       "name": "ox"
                 *     }
                 */
                "application/json": components["schemas"]["ImportFileBody"];
            };
        };
        responses: {
            /** @description File imported and committed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Bad Request / Invalid URL */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_workspaces_workspace_id_copy_path: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
                /**
                 * @description The path of the committed file to copy
                 * @example annotations/train.csv
                 */
                path: string;
            };
            cookie?: never;
        };
        /** @description The path for the copy */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "new_path": "annotations/train_results.csv"
                 *     }
                 */
                "application/json": components["schemas"]["RenameRequest"];
            };
        };
        responses: {
            /** @description Copy staged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Invalid request (empty new_path, or the path is a directory) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace or file not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description new_path already exists or is staged, a file is at a parent of new_path, or the source has changes staged in the workspace */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_repos_namespace_repo_name_versions_uploads_upload_id_parts_part_number: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /** @description The id the upload began with */
                upload_id: string;
                /**
                 * @description The part's number, counting from 1
                 * @example 1
                 */
                part_number: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": number[];
            };
        };
        responses: {
            /** @description Part stored */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionUploadPartResponse"];
                };
            };
            /** @description Part out of range, of the wrong length, or the file's bytes do not match its hash */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Upload not found: it never began, was aborted, or already completed */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Part arrived too far ahead of the parts before it, or an earlier copy of it is still being stored. Send it again after Retry-After */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_commits: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Commit object and target branch name. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "author": "Bessie Oxington",
                 *       "branch_name": "main",
                 *       "email": "bessie@oxen.ai",
                 *       "id": "abc1234567890def1234567890fedcba",
                 *       "message": "Empty commit for testing"
                 *     }
                 */
                "application/json": components["schemas"]["Commit"];
            };
        };
        responses: {
            /** @description Commit created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Invalid commit data or mismatched remote history */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_data_frames_from_directory_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example CattleData
                 */
                repo_name: string;
                /**
                 * @description Directory path to read from (including branch/commit info)
                 * @example main/data/images
                 */
                resource: string;
            };
            cookie?: never;
        };
        /** @description Options for creating a data frame from a directory, including output path, columns, and commit message. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "commit_message": "Generated image index",
                 *       "extra_columns": [
                 *         "size",
                 *         "extension"
                 *       ],
                 *       "output_path": "data/image_index.csv",
                 *       "recursive": true,
                 *       "user_email": "bessie@oxen.ai",
                 *       "user_name": "Bessie"
                 *     }
                 */
                "application/json": components["schemas"]["FromDirectoryRequest"];
            };
        };
        responses: {
            /** @description Data frame created and committed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Invalid request body or resource path */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository or resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_history_resource: {
        parameters: {
            query?: {
                page?: number | null;
                page_size?: number | null;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Commit ID, Branch name, or path to a file/directory
                 * @example main/data/train/image.jpg
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of commits, newest first. A revision's history carries its total count, and a file or directory's history reports whether a later page exists. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitHistory"];
                };
            };
            /** @description Repository or resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_namespaces_namespace: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Name of the namespace */
                namespace: string;
                /** @description The namespace's directory in the legacy layout, when it is not named for the namespace. */
                legacy_directory: string | null;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Namespace details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NamespaceResponse"];
                };
            };
            /** @description Missing namespace parameter, or a `legacy_directory` that is not a single path segment */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Namespace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_versions_version_id_metadata: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The hash ID of the file version
                 * @example 1eb45ac94f3eab120f3a
                 */
                version_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File metadata found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionFileResponse"];
                };
            };
            /** @description Version file not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_import_upload_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example Wiki-Text
                 */
                repo_name: string;
                /**
                 * @description Destination path (including branch)
                 * @example main/archive
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["ZipUploadBody"];
            };
        };
        responses: {
            /** @description Zip archive decompressed and committed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_workspaces_workspace_id_files_path: {
        parameters: {
            query?: {
                /**
                 * @description Width for image resize or video thumbnail
                 * @example 320
                 */
                width?: number;
                /**
                 * @description Height for image resize or video thumbnail
                 * @example 240
                 */
                height?: number;
                /**
                 * @description Timestamp in seconds to extract video thumbnail from
                 * @example 1
                 */
                timestamp?: number;
                /**
                 * @description Set to true to generate a video thumbnail instead of returning the full video
                 * @example true
                 */
                thumbnail?: boolean;
            };
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
                /**
                 * @description The path to the file in the workspace
                 * @example images/train/dog_1.jpg
                 */
                path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File content returned as a stream. Content-Type varies: matches the file's MIME type for regular files and image resizes, or 'image/jpeg' for video thumbnails */
            200: {
                headers: {
                    /** @description The commit ID of the file version */
                    "oxen-revision-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": number[];
                };
            };
            /** @description Invalid parameters */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace or File not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_workspaces_workspace_id_files_path: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
                /**
                 * @description The target path to upload the file to
                 * @example data/train
                 */
                path: string;
            };
            cookie?: never;
        };
        /** @description Multipart upload of file. Each file should be sent as a separate file part */
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["FileUpload"];
            };
        };
        responses: {
            /** @description File successfully uploaded to workspace */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FilePathsResponse"];
                };
            };
            /** @description Invalid upload request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_repos_namespace_repo_name_workspaces_workspace_id_data_frames_schema_path: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description ID or name of the workspace
                 * @example b3f27f05-0955-4076-805f-39575853b27b
                 */
                workspace_id: string;
                /**
                 * @description Path to the data frame within the repository
                 * @example annotations/train.csv
                 */
                path: string;
            };
            cookie?: never;
        };
        /** @description The metadata to store on the schema, under a `metadata` key. The `_oxen` key is reserved for metadata oxen itself interprets. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "metadata": {
                 *         "description": "Extracting bounding boxes from images",
                 *         "task": "bounding_box"
                 *       }
                 *     }
                 */
                "text/plain": string;
            };
        };
        responses: {
            /** @description Schema metadata updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Missing or invalid `metadata` in the request body, or the path is not a tabular data frame */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository, workspace, or data frame not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The data frame is staged for removal in this workspace */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_missing: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description List of commit hashes present on the client. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "hashes": [
                 *         "abc1234567890def1234567890fedcba",
                 *         "84c76a5b2e9a2637f9091991475c404d"
                 *       ]
                 *     }
                 */
                "application/json": components["schemas"]["MerkleHashes"];
            };
        };
        responses: {
            /** @description List of commit hashes missing on the server */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MerkleHashesResponse"];
                };
            };
            /** @description Invalid JSON body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_workspaces_workspace_id_changes_path: {
        parameters: {
            query?: {
                /** @description Page number for pagination (default 1) */
                page?: number;
                /** @description Number of entries per page (default 100, must be at least 1) */
                page_size?: number;
            };
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
                /**
                 * @description The directory to list staged changes under
                 * @example images/train
                 */
                path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged changes under the directory */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RemoteStagedStatusResponse"];
                };
            };
            /** @description Invalid page_size */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name_workspaces_workspace_id_changes_path: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
                /**
                 * @description The path to the file to delete (unstage)
                 * @example images/train/dog_1.jpg
                 */
                path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File marked for deletion */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Workspace or File not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_merge_base_head: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example satellite-images
                 */
                repo_name: string;
                /**
                 * @description The base and head revisions separated by '..'
                 * @example main..feature/add-labels
                 */
                base_head: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Merge status returned successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MergeableResponse"];
                };
            };
            /** @description Repository or one of the revisions not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_merge_base_head: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example satellite-images
                 */
                repo_name: string;
                /**
                 * @description The base and head revisions separated by '..'
                 * @example main..feature/add-labels
                 */
                base_head: string;
            };
            cookie?: never;
        };
        /** @description Author for the merge commit (the user initiating the merge). Required: name and email must both be present and non-empty. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "email": "bessie@oxen.ai",
                 *       "name": "bessie"
                 *     }
                 */
                "application/json": {
                    email: string;
                    name: string;
                };
            };
        };
        responses: {
            /** @description Branches merged successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MergeSuccessResponse"];
                };
            };
            /** @description Missing merge author (name and email) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository or one of the revisions not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Merge conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_missing_files: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /** @example abc1234567890def1234567890fedcba */
                base: string | null;
                /** @example 84c76a5b2e9a2637f9091991475c404d */
                head: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of missing file entries */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListCommitEntryResponse"];
                };
            };
            /** @description Repository or commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_file_resource: {
        parameters: {
            query?: {
                /**
                 * @description Width for image resize or video thumbnail
                 * @example 320
                 */
                width?: number;
                /**
                 * @description Height for image resize or video thumbnail
                 * @example 240
                 */
                height?: number;
                /**
                 * @description Timestamp in seconds to extract video thumbnail from (default: 1.0)
                 * @example 1
                 */
                timestamp?: number;
                /**
                 * @description Set to true to generate a video thumbnail instead of returning the full video
                 * @example true
                 */
                thumbnail?: boolean;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example Voice-Data
                 */
                repo_name: string;
                /**
                 * @description Path to the file (including branch/commit info)
                 * @example main/audio/moo.wav
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File content stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": number[];
                };
            };
            /** @description File not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_repos_namespace_repo_name_file_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Path of the directory to add files in (including branch)
                 * @example main/train/images
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["FileUploadBody"];
            };
        };
        responses: {
            /** @description Files committed successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Branch or path not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name_file_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Path to the file to be deleted (including branch)
                 * @example main/train/images/n01440764_10026.JPEG
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["FileUploadBody"];
            };
        };
        responses: {
            /** @description File removed successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Branch or path not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_repos_namespace_repo_name_file_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Path to the source file (including branch)
                 * @example main/train/images/old_name.jpg
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileMoveBody"];
            };
        };
        responses: {
            /** @description File moved/renamed successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Branch or file not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description new_path already exists, or a file is at a parent of new_path */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_workspaces_workspace_id_changes: {
        parameters: {
            query?: {
                /** @description Page number for pagination (default 1) */
                page?: number;
                /** @description Number of entries per page (default 100, must be at least 1) */
                page_size?: number;
            };
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged changes in the workspace */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RemoteStagedStatusResponse"];
                };
            };
            /** @description Invalid page_size */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Workspace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name_workspaces_workspace_id_changes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
            };
            cookie?: never;
        };
        /** @description List of paths to unstage from the workspace staging area */
        requestBody: {
            content: {
                /**
                 * @example [
                 *       "images/train/revert_me.jpg",
                 *       "data/config.json"
                 *     ]
                 */
                "application/json": string[];
            };
        };
        responses: {
            /** @description Files unstaged from staging */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Some files could not be unstaged (returns paths of files not found) */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FilePathsResponse"];
                };
            };
            /** @description Workspace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_versions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Multipart upload of files. Each form field 'file[]' or 'file' should contain the file content (optionally gzip compressed), and the filename should be the content hash (e.g., 'file.jpg' is not used, the hash is the identifier). */
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadVersionFile"];
            };
        };
        responses: {
            /** @description Files successfully uploaded (check err_files for failures) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorFilesResponse"];
                };
            };
            /** @description Invalid multipart request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_all: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                page: number | null;
                page_size: number | null;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paginated list of all commits */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedCommits"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_branches_branch_name_versions_path: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Name of the branch
                 * @example main
                 */
                branch_name: string;
                /**
                 * @description Path to the file or dir
                 * @example images/train.jpg
                 */
                path: string;
                page: number | null;
                page_size: number | null;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of entry versions found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedEntryVersionsResponse"];
                };
            };
            /** @description Repository, branch or path not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_version: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Server is running */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
        };
    };
    delete_api_repos_namespace_repo_name_workspaces_workspace_id_files: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description The UUID of the workspace
                 * @example 580c0587-c157-417b-9118-8686d63d2745
                 */
                workspace_id: string;
            };
            cookie?: never;
        };
        /** @description List of paths to stage for removal */
        requestBody: {
            content: {
                /**
                 * @example [
                 *       "images/train/dog_1.jpg",
                 *       "annotations/incorrect.xml"
                 *     ]
                 */
                "application/json": string[];
            };
        };
        responses: {
            /** @description Files successfully removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FilePathsResponse"];
                };
            };
            /** @description Some files could not be found/removed (returns paths of files not found) */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FilePathsResponse"];
                };
            };
            /** @description Workspace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_namespaces: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of namespaces */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListNamespacesResponse"];
                };
            };
        };
    };
    patch_api_repos_namespace_repo_name_transfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Current namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example Cat-Dog-Classifier
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Target namespace to transfer the repository to. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "namespace": "new_org"
                 *     }
                 */
                "application/json": components["schemas"]["TransferNamespaceRequest"];
            };
        };
        responses: {
            /** @description Repository transferred successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepositoryResponse"];
                };
            };
            /** @description Invalid body or target namespace */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_repos_namespace_repo_name_rename: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example Cat-Dog-Classifier
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description The repository's new name. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "repo_name": "Cat-Dog-Detector"
                 *     }
                 */
                "application/json": components["schemas"]["RenameRepoRequest"];
            };
        };
        responses: {
            /** @description Repository renamed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepositoryResponse"];
                };
            };
            /** @description Invalid body or name, or a server whose directories carry names */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Another repository in the namespace holds the name */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_branches: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of branches */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "branches": [
                     *         {
                     *           "commit": {
                     *             "author": "Bessie Oxington",
                     *             "email": "hello@oxen.ai",
                     *             "id": "592d564750031fa1431000472c2d721d",
                     *             "message": "update README",
                     *             "timestamp": "2024-11-25T21:11:12Z"
                     *           },
                     *           "commit_id": "592d564750031fa1431000472c2d721d",
                     *           "name": "main"
                     *         },
                     *         {
                     *           "commit": {
                     *             "author": "Daisy Oxington",
                     *             "email": "daisy@oxen.ai",
                     *             "id": "abc1234567890def1234567890fedcba",
                     *             "message": "added new validation data",
                     *             "timestamp": "2024-11-25T20:00:00Z"
                     *           },
                     *           "commit_id": "abc1234567890def1234567890fedcba",
                     *           "name": "development"
                     *         }
                     *       ],
                     *       "oxen_version": "0.22.2",
                     *       "status": "success",
                     *       "status_message": "resource_found"
                     *     }
                     */
                    "application/json": components["schemas"]["ListBranchesResponse"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_branches: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Branch creation details. Can be created from another branch or a commit ID. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "from_name": "main",
                 *       "new_name": "development"
                 *     }
                 */
                "application/json": components["schemas"]["BranchNewFromBranchName"];
            };
        };
        responses: {
            /** @description Branch created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchResponse"];
                };
            };
            /** @description Invalid request body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository or source branch/commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_size: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Repository size in bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepoSizeFile"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_size: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Repository size updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Repository details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepositoryDataTypesResponse"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example Cat-Dog-Classifier
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Repository deletion started */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Namespace or repository name is not a single path segment */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_workspaces_workspace_id_data_frames_columns_schema_metadata_path: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description ID or name of the workspace
                 * @example b3f27f05-0955-4076-805f-39575853b27b
                 */
                workspace_id: string;
                /**
                 * @description Path to the data frame within the repository
                 * @example annotations/train.csv
                 */
                path: string;
            };
            cookie?: never;
        };
        /** @description The column to annotate and the metadata to store on it. `_oxen.render.func` controls how oxen renders the column's values. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "column_name": "file",
                 *       "metadata": {
                 *         "_oxen": {
                 *           "render": {
                 *             "func": "image"
                 *           }
                 *         }
                 *       }
                 *     }
                 */
                "text/plain": string;
            };
        };
        responses: {
            /** @description Column metadata updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Invalid request body, missing `column_name`, the path is not a tabular data frame, or the column does not exist in the schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository, workspace, or data frame not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The data frame is staged for removal in this workspace */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_base_head_dir_hashes_db: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Commit ID range (base..head) or single commit ID
                 * @example abc1234..84c76a5
                 */
                base_head: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tarball of dir hashes DB */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid base_head format */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository or commit not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_commits_commit_or_branch_parents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Commit ID or Branch name
                 * @example main
                 */
                commit_or_branch: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of parent commits */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListCommitResponse"];
                };
            };
            /** @description Commit or Branch not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_workspaces: {
        parameters: {
            query?: {
                name?: string | null;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of workspaces */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListWorkspaceResponseView"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_repos_namespace_repo_name_workspaces: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        /** @description Workspace creation details, including base branch and optional name/ID. */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "branch_name": "main",
                 *       "name": "bessie_workspace",
                 *       "workspace_id": "b3f27f05-0955-4076-805f-39575853b27b"
                 *     }
                 */
                "application/json": components["schemas"]["NewWorkspace"];
            };
        };
        responses: {
            /** @description Workspace found or created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceResponseView"];
                };
            };
            /** @description Invalid payload or branch not found */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_repos_namespace_repo_name_workspaces: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace for the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Workspaces cleared */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_versions_uploads: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description The name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BeginVersionUploadRequest"];
            };
        };
        responses: {
            /** @description Upload begun, or the file already stored */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionUploadResponse"];
                };
            };
            /** @description Invalid hash, size, or destination */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository or workspace not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository busy with maintenance */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_dir_resource: {
        parameters: {
            query?: {
                page?: number | null;
                page_size?: number | null;
                api_version?: string | null;
                /** @description Depth of nested directory traversal. 0 = current directory only (default), 1 = include immediate children, -1 = unlimited. */
                depth?: number | null;
                /** @description Sort entries by "name" (default) or "date" (latest commit timestamp). */
                sort_by?: string | null;
                /** @description Reverse the sort order. Default is false (ascending). */
                reverse?: boolean | null;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Path to the directory (including branch/commit ID)
                 * @example main/data/train
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paginated list of directory entries */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaginatedDirEntriesResponse"];
                };
            };
            /** @description Directory or repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Repository creation payload (JSON or Multipart) */
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "description": "A repository for image classification",
                 *       "name": "Cat-Dog-Classifier",
                 *       "namespace": "ox",
                 *       "user": {
                 *         "email": "bessie@oxen.ai",
                 *         "name": "bessie"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["RepoNew"];
            };
        };
        responses: {
            /** @description Repository created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepositoryCreationResponse"];
                };
            };
            /** @description Invalid payload */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_compare_entries_base_head: {
        parameters: {
            query?: {
                /** @description Page number for pagination (starts at 1) */
                page?: number;
                /** @description Page size for pagination */
                page_size?: number;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example satellite-images
                 */
                repo_name: string;
                /**
                 * @description The base and head revisions separated by '..', or '...' to diff from the merge base
                 * @example main...feature/add-labels
                 */
                base_head: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Entries found successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareEntriesResponse"];
                };
            };
            /** @description Repository or one of the revisions not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_compare_commits_base_head: {
        parameters: {
            query?: {
                /** @description Page number for pagination (starts at 1) */
                page?: number;
                /** @description Page size for pagination */
                page_size?: number;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example satellite-images
                 */
                repo_name: string;
                /**
                 * @description The base and head revisions separated by '..', or '...' for the commits on either side but not both
                 * @example main...feature/add-labels
                 */
                base_head: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Commits found successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareCommitsResponse"];
                };
            };
            /** @description Repository or one of the revisions not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_compare_dir_tree_base_head: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example satellite-images
                 */
                repo_name: string;
                /**
                 * @description The base and head revisions separated by '..', or '...' to diff from the merge base
                 * @example main...feature/add-labels
                 */
                base_head: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Directory diff tree found successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DirTreeDiffResponse"];
                };
            };
            /** @description Repository or one of the revisions not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_compare_entries_base_head_dir_dir: {
        parameters: {
            query?: {
                /** @description Page number for pagination (starts at 1) */
                page?: number;
                /** @description Page size for pagination */
                page_size?: number;
            };
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example satellite-images
                 */
                repo_name: string;
                /**
                 * @description The base and head revisions separated by '..', or '...' to diff from the merge base
                 * @example main...feature/add-labels
                 */
                base_head: string;
                /**
                 * @description The directory path to list entries for
                 * @example data/test
                 */
                dir: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Entries found successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareEntriesResponse"];
                };
            };
            /** @description Repository, revision, or directory not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_data_frames_index_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example CattleData
                 */
                repo_name: string;
                /**
                 * @description Path to the tabular file to index (including branch/commit info)
                 * @example main/data/weights.csv
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Indexing process started or completed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Dataset already indexed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_repos_namespace_repo_name_meta_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Path to the file/dir (including branch/commit info)
                 * @example main/images/train/dog_1.jpg
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Metadata for the entry found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EMetadataEntryResponseView"];
                };
            };
            /** @description Invalid resource path */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Entry not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_repos_namespace_repo_name_meta_resource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Namespace of the repository
                 * @example ox
                 */
                namespace: string;
                /**
                 * @description Name of the repository
                 * @example ImageNet-1k
                 */
                repo_name: string;
                /**
                 * @description Path to the file (including version to update)
                 * @example versions/files/b4/158b417c800c7322d711f1816f5c00e1215b4d7c001c9b6892556d11/data
                 */
                resource: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Metadata updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusMessage"];
                };
            };
            /** @description Missing version in resource path */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Repository not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
