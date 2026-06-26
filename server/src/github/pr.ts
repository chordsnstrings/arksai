// Open a pull request via the GitHub REST API. Used by the open_pull_request agent tool so a
// change to a connected repo lands as a reviewable PR (branch → PR → human/CI), the way Claude
// Code works — instead of pushing straight onto the user's branch.

export interface OpenPrInput {
  owner: string;
  repo: string;
  token: string;
  title: string;
  head: string; // the working branch (must already be pushed)
  base: string; // the branch to merge into
  body?: string;
  draft?: boolean;
}

export interface OpenPrResult {
  ok: boolean;
  url?: string;
  number?: number;
  error?: string;
}

/** Parse "owner/repo" (or a full GitHub URL) into its parts. */
export function parseOwnerRepo(nameOrUrl: string): { owner: string; repo: string } | null {
  const t = nameOrUrl.trim().replace(/\.git$/, '');
  let m = t.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)\/?$/);
  if (!m) m = t.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export async function createPullRequest(input: OpenPrInput): Promise<OpenPrResult> {
  const { owner, repo, token, title, head, base, body, draft } = input;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'ArksAI',
      },
      body: JSON.stringify({ title, head, base, body: body || '', draft: !!draft }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // GitHub returns a useful errors[] array (e.g. "No commits between base and head", or an
      // existing PR for this branch).
      const detail =
        data?.errors?.map((e: any) => e.message).filter(Boolean).join('; ') ||
        data?.message ||
        `HTTP ${res.status}`;
      return { ok: false, error: detail };
    }
    return { ok: true, url: data.html_url, number: data.number };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
