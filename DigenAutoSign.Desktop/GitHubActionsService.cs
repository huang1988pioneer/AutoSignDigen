using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DigenAutoSign.Desktop;

internal sealed class GitHubActionsService
{
    private const string Workflow = "digen-daily-reward.yml";
    private const string FallbackRepository = "huang1988pioneer/AutoSignDigen";

    public async Task TriggerAsync(string repository)
    {
        await RunGhAsync(["workflow", "run", Workflow, "--repo", repository, "--ref", "main"]);
    }

    public async Task<RunInfo?> GetLatestAsync(string repository)
    {
        var output = await RunGhAsync([
            "run", "list",
            "--workflow", Workflow,
            "--repo", repository,
            "--limit", "1",
            "--json", "databaseId,status,conclusion,createdAt,updatedAt,url"
        ]);
        return JsonSerializer.Deserialize<List<RunInfo>>(output, JsonOptions())?.FirstOrDefault();
    }

    public async Task<AccountRunStatus[]> GetAccountStatusesAsync(string repository, long runId)
    {
        try
        {
            var output = await RunGhAsync([
                "run", "view", runId.ToString(),
                "--repo", repository,
                "--json", "jobs"
            ]);
            using var document = JsonDocument.Parse(output);
            if (!document.RootElement.TryGetProperty("jobs", out var jobsElement))
                return EmptyStatuses();

            var byNumber = new Dictionary<int, AccountRunStatus>();
            foreach (var job in jobsElement.EnumerateArray())
            {
                var name = job.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? string.Empty : string.Empty;
                var match = Regex.Match(name, @"checkin-token-(?<number>\d+)\s*-\s*(?<alias>.+)", RegexOptions.IgnoreCase);
                if (!match.Success) continue;

                var number = int.Parse(match.Groups["number"].Value);
                var alias = match.Groups["alias"].Value.Trim();
                var conclusion = job.TryGetProperty("conclusion", out var conclusionEl) ? conclusionEl.GetString() : null;
                var status = job.TryGetProperty("status", out var statusEl) ? statusEl.GetString() : null;
                var display = string.IsNullOrWhiteSpace(conclusion) ? (status ?? "unknown") : conclusion;
                var configured = !string.Equals(display, "skipped", StringComparison.OrdinalIgnoreCase);

                // Matrix jobs for missing secrets often complete with success after writing skipped result.
                // Prefer job name label; mark unconfigured when conclusion is skipped or name is default accountN with skipped artifact semantics.
                byNumber[number] = new AccountRunStatus(number, alias, display, configured);
            }

            return Enumerable.Range(1, 33)
                .Select(number => byNumber.GetValueOrDefault(number)
                    ?? new AccountRunStatus(number, $"account{number}", "未出現在此 run", false))
                .ToArray();
        }
        catch
        {
            return EmptyStatuses();
        }
    }

    public async Task<string> GetRepositoryAsync(string? preferredWorkspace = null)
    {
        try
        {
            var args = new List<string> { "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner" };
            if (!string.IsNullOrWhiteSpace(preferredWorkspace))
            {
                // When cwd is the repo, gh can resolve it without --repo.
            }

            var output = await RunGhAsync(args, preferredWorkspace);
            var name = output.Trim();
            return string.IsNullOrWhiteSpace(name) ? FallbackRepository : name;
        }
        catch
        {
            return FallbackRepository;
        }
    }

    private static AccountRunStatus[] EmptyStatuses() =>
        Enumerable.Range(1, 33)
            .Select(number => new AccountRunStatus(number, $"account{number}", "尚未讀取", false))
            .ToArray();

    private static async Task<string> RunGhAsync(IEnumerable<string> arguments, string? workingDirectory = null)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = ResolveGhPath(),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                CreateNoWindow = true,
                WorkingDirectory = workingDirectory ?? Environment.CurrentDirectory
            }
        };
        foreach (var argument in arguments)
            process.StartInfo.ArgumentList.Add(argument);

        if (!process.Start())
            throw new InvalidOperationException("無法啟動 GitHub CLI (gh)。請先安裝並執行 gh auth login。");

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var output = await stdout;
        var error = await stderr;
        if (process.ExitCode == 0) return output;
        throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? output.Trim() : error.Trim());
    }

    private static string ResolveGhPath()
    {
        if (!OperatingSystem.IsWindows()) return "gh";
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "GitHub CLI", "gh.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "GitHub CLI", "gh.exe")
        };
        return candidates.FirstOrDefault(File.Exists) ?? "gh";
    }

    private static JsonSerializerOptions JsonOptions() => new() { PropertyNameCaseInsensitive = true };
}

internal sealed record RunInfo(
    long DatabaseId,
    string Status,
    string? Conclusion,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string Url);

internal sealed record AccountRunStatus(int Number, string Alias, string Status, bool IsConfigured);
