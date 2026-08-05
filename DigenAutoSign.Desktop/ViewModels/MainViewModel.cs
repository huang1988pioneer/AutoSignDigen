using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Platform.Storage;
using DigenAutoSign.Desktop.Models;

namespace DigenAutoSign.Desktop.ViewModels;

public sealed class MainViewModel : ObservableObject
{
    private readonly Window _window;
    private string _workspaceRoot;
    private string _browser = "chrome";
    private string _status = "準備就緒";
    private string _logText = "尚無執行紀錄。請選取帳號後建立登入狀態，或執行全部每日簽到。";
    private int _consecutiveCheckinDays;
    private string _workflowSummary = "尚未同步";
    private string _workflowDetail = "Node / Playwright 命令的完整輸出會顯示於此。";
    private string _currentView = "Dashboard";
    private string _tokenStatus = "選擇已設定的帳號，完成登入後即可複製 Digen Token。";
    private static readonly HttpClient GitHubClient = CreateGitHubClient();
    private AccountEntry? _selectedAccount;
    private bool _isRunning;

    public MainViewModel(Window window)
    {
        _window = window;
        _workspaceRoot = FindWorkspaceRoot() ?? Environment.CurrentDirectory;
        ReloadCommand = new RelayCommand(() => _ = ReloadAsync());
        BrowseWorkspaceCommand = new RelayCommand(() => _ = BrowseWorkspaceAsync());
        AddAccountCommand = new RelayCommand(AddAccount);
        RemoveAccountCommand = new RelayCommand(RemoveAccount, () => SelectedAccount is not null);
        SaveCommand = new RelayCommand(() => _ = SaveAsync());
        LoginCommand = new RelayCommand(() => _ = RunLoginAsync(), CanRunSelected);
        CheckSelectedCommand = new RelayCommand(() => _ = RunCheckinAsync(SelectedAccount), CanRunSelected);
        CheckAllCommand = new RelayCommand(() => _ = RunCheckinAsync(null), () => !_isRunning && Accounts.Any(x => x.Enabled));
        ClearLogCommand = new RelayCommand(() => LogText = string.Empty);
        ShowDashboardCommand = new RelayCommand(() => CurrentView = "Dashboard");
        ShowAccountsCommand = new RelayCommand(() => CurrentView = "Accounts");
        ShowLoginStateCommand = new RelayCommand(() => CurrentView = "Login");
        ExportTokenCommand = new RelayCommand(() => _ = ExportTokenAsync(), CanRunSelected);
        TriggerWorkflowCommand = new RelayCommand(() => _ = TriggerWorkflowAsync(), () => !_isRunning);
        _ = ReloadAsync();
    }

    public ObservableCollection<AccountEntry> Accounts { get; } = [];
    public IReadOnlyList<string> Browsers { get; } = ["chrome", "edge"];
    public RelayCommand ReloadCommand { get; }
    public RelayCommand BrowseWorkspaceCommand { get; }
    public RelayCommand AddAccountCommand { get; }
    public RelayCommand RemoveAccountCommand { get; }
    public RelayCommand SaveCommand { get; }
    public RelayCommand LoginCommand { get; }
    public RelayCommand CheckSelectedCommand { get; }
    public RelayCommand CheckAllCommand { get; }
    public RelayCommand ClearLogCommand { get; }
    public RelayCommand ShowDashboardCommand { get; }
    public RelayCommand ShowAccountsCommand { get; }
    public RelayCommand ShowLoginStateCommand { get; }
    public RelayCommand ExportTokenCommand { get; }
    public RelayCommand TriggerWorkflowCommand { get; }
    public string WorkspaceRoot { get => _workspaceRoot; set { if (SetProperty(ref _workspaceRoot, value)) _ = ReloadAsync(); } }
    public string Browser { get => _browser; set => SetProperty(ref _browser, value); }
    public string Status { get => _status; private set => SetProperty(ref _status, value); }
    public string LogText { get => _logText; private set => SetProperty(ref _logText, value); }
    public int ConsecutiveCheckinDays { get => _consecutiveCheckinDays; private set => SetProperty(ref _consecutiveCheckinDays, value); }
    public string WorkflowSummary { get => _workflowSummary; private set => SetProperty(ref _workflowSummary, value); }
    public string WorkflowDetail { get => _workflowDetail; private set => SetProperty(ref _workflowDetail, value); }
    public string TokenStatus { get => _tokenStatus; private set => SetProperty(ref _tokenStatus, value); }
    public string SecretName => SelectedAccount is null ? "DIGEN_TOKEN" : $"DIGEN_TOKEN{Accounts.IndexOf(SelectedAccount) + 1}";
    public string CurrentView
    {
        get => _currentView;
        private set
        {
            if (!SetProperty(ref _currentView, value)) return;
            OnPropertyChanged(nameof(IsDashboard)); OnPropertyChanged(nameof(IsAccounts)); OnPropertyChanged(nameof(IsLogin));
        }
    }
    public bool IsDashboard => CurrentView == "Dashboard";
    public bool IsAccounts => CurrentView == "Accounts";
    public bool IsLogin => CurrentView == "Login";
    public AccountEntry? SelectedAccount
    {
        get => _selectedAccount;
        set { if (SetProperty(ref _selectedAccount, value)) { OnPropertyChanged(nameof(HasSelectedAccount)); OnPropertyChanged(nameof(SecretName)); RaiseCommandStates(); } }
    }
    public bool HasSelectedAccount => SelectedAccount is not null;

    private bool CanRunSelected() => !_isRunning && SelectedAccount is not null;

    private async Task BrowseWorkspaceAsync()
    {
        var folders = await _window.StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions { Title = "選擇 Digen Auto Sign 工作目錄", AllowMultiple = false });
        if (folders.Count > 0 && folders[0].TryGetLocalPath() is { } path) WorkspaceRoot = path;
    }

    private async Task ReloadAsync()
    {
        try
        {
            var path = Path.Combine(WorkspaceRoot, "accounts.json");
            if (!File.Exists(path)) { Accounts.Clear(); Status = "找不到 accounts.json"; AppendLog("找不到 accounts.json；可由 accounts.example.json 建立設定檔。"); return; }
            var config = JsonSerializer.Deserialize<AccountConfig>(await File.ReadAllTextAsync(path), JsonOptions()) ?? throw new InvalidDataException("accounts.json 格式無法讀取。");
            Accounts.Clear();
            foreach (var account in config.Accounts ?? []) Accounts.Add(new AccountEntry { Name = account.Name ?? string.Empty, Enabled = account.Enabled });
            await RefreshConsecutiveCheckinDaysAsync();
            await RefreshGitHubWorkflowAsync();
            Status = $"已載入 {Accounts.Count} 個帳號";
            AppendLog($"已載入帳號設定：{path}");
        }
        catch (Exception ex) { Status = "讀取帳號設定失敗"; AppendLog($"讀取失敗：{ex.Message}"); }
        RaiseCommandStates();
    }

    private void AddAccount()
    {
        var number = 1; while (Accounts.Any(x => x.Name.Equals($"account{number}", StringComparison.OrdinalIgnoreCase))) number++;
        var account = new AccountEntry { Name = $"account{number}" }; Accounts.Add(account); SelectedAccount = account; Status = "已新增帳號，請儲存設定";
    }
    private void RemoveAccount()
    {
        if (SelectedAccount is null) return; Accounts.Remove(SelectedAccount); SelectedAccount = Accounts.FirstOrDefault(); Status = "已移除帳號，請儲存設定";
    }
    private async Task SaveAsync()
    {
        try
        {
            if (Accounts.Any(x => string.IsNullOrWhiteSpace(x.Name))) throw new InvalidDataException("帳號名稱不可空白。");
            if (Accounts.GroupBy(x => x.Name, StringComparer.OrdinalIgnoreCase).Any(x => x.Count() > 1)) throw new InvalidDataException("帳號名稱不可重複。");
            var config = new AccountConfig { Accounts = Accounts.Select(x => new ConfigAccount { Name = x.Name.Trim(), Enabled = x.Enabled }).ToList() };
            var path = Path.Combine(WorkspaceRoot, "accounts.json"); await File.WriteAllTextAsync(path, JsonSerializer.Serialize(config, JsonOptions())); Status = "設定已儲存"; AppendLog($"已儲存帳號設定：{path}");
        }
        catch (Exception ex) { Status = "儲存設定失敗"; AppendLog($"儲存失敗：{ex.Message}"); }
    }
    private async Task RunLoginAsync()
    {
        if (SelectedAccount is null) return;
        TokenStatus = "瀏覽器已開啟；完成 Digen 登入後，請直接關閉該瀏覽器視窗。";
        await RunNodeAsync("login.js", $"{Quote(SelectedAccount.Name)} --browser={Browser} --wait-for-close", SelectedAccount);
        TokenStatus = "登入狀態已儲存至本機 profile。現在可複製 Digen Token。";
    }
    private async Task ExportTokenAsync()
    {
        if (SelectedAccount is null) return;
        try
        {
            TokenStatus = "正在從本機瀏覽器登入狀態讀取 Digen Token…";
            var scriptPath = Path.Combine(WorkspaceRoot, "scripts", "export-token.js");
            var result = await ExecuteProcessAsync("node", $"{Quote(scriptPath)} {Quote(SelectedAccount.Name)} --browser={Browser}", WorkspaceRoot);
            if (result.ExitCode != 0) throw new InvalidOperationException(result.Output);
            using var document = JsonDocument.Parse(result.Output);
            var token = document.RootElement.GetProperty("token").GetString();
            if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("找不到 Digen Token。");
            if (_window.Clipboard is null) throw new InvalidOperationException("無法使用系統剪貼簿。");
            await _window.Clipboard.SetTextAsync(token);
            TokenStatus = $"已複製 Digen Token；請貼入 GitHub Repository Secret：{SecretName}。";
        }
        catch (Exception ex) { TokenStatus = $"無法匯出 Token：{ex.Message}"; }
    }
    private async Task RunCheckinAsync(AccountEntry? account) => await RunNodeAsync("api-reward.js", account is null ? $"--browser={Browser}" : $"{Quote(account.Name)} --browser={Browser}", account);
    private async Task TriggerWorkflowAsync()
    {
        SetRunning(true, "正在觸發 GitHub Actions…");
        try
        {
            var result = await ExecuteProcessAsync("gh", "workflow run digen-daily-reward.yml --repo huang1988pioneer/AutoSignDigen --ref main", WorkspaceRoot);
            if (result.ExitCode != 0) throw new InvalidOperationException(result.Output);
            Status = "已觸發 GitHub Actions，稍候再更新執行結果。";
            AppendLog("已觸發 Digen Daily Reward workflow。");
        }
        catch (Exception ex)
        {
            Status = "無法觸發 GitHub Actions";
            AppendLog($"觸發 workflow 失敗：{ex.Message}\n請安裝 GitHub CLI 並先執行 gh auth login。");
        }
        finally { SetRunning(false, Status); }
    }
    private async Task RunNodeAsync(string script, string arguments, AccountEntry? account)
    {
        var scriptPath = Path.Combine(WorkspaceRoot, "scripts", script);
        if (!File.Exists(scriptPath)) { Status = "找不到執行腳本"; AppendLog($"找不到：{scriptPath}"); return; }
        SetRunning(true, account is null ? "正在執行全部帳號" : $"正在執行 {account.Name}"); AppendLog($"> node scripts/{script} {arguments}");
        try { var result = await ExecuteProcessAsync("node", $"{Quote(scriptPath)} {arguments}", WorkspaceRoot); AppendLog(result.Output); var success = result.ExitCode == 0; if (account is not null) account.Result = success ? "執行成功" : "執行失敗"; Status = success ? "執行成功" : $"執行失敗（代碼 {result.ExitCode}）"; }
        catch (Exception ex) { if (account is not null) account.Result = "執行失敗"; Status = "執行失敗"; AppendLog($"執行失敗：{ex.Message}\n請確認已安裝 Node.js 並執行 npm install。"); }
        finally { await RefreshConsecutiveCheckinDaysAsync(); await RefreshGitHubWorkflowAsync(); SetRunning(false, Status); }
    }
    private static async Task<ProcessResult> ExecuteProcessAsync(string fileName, string arguments, string workingDirectory)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(fileName, arguments) { WorkingDirectory = workingDirectory, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 } };
        process.Start(); var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync(); await process.WaitForExitAsync(); return new ProcessResult(process.ExitCode, ((await stdout) + Environment.NewLine + (await stderr)).Trim());
    }
    private void SetRunning(bool running, string status) { _isRunning = running; Status = status; RaiseCommandStates(); }
    private void RaiseCommandStates() { RemoveAccountCommand.RaiseCanExecuteChanged(); LoginCommand.RaiseCanExecuteChanged(); CheckSelectedCommand.RaiseCanExecuteChanged(); CheckAllCommand.RaiseCanExecuteChanged(); ExportTokenCommand.RaiseCanExecuteChanged(); TriggerWorkflowCommand.RaiseCanExecuteChanged(); }
    private void AppendLog(string value) => LogText = $"[{DateTime.Now:HH:mm:ss}] {value.Trim()}\n\n{LogText}";
    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";
    private static JsonSerializerOptions JsonOptions() => new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private async Task RefreshConsecutiveCheckinDaysAsync()
    {
        try
        {
            var logsPath = Path.Combine(WorkspaceRoot, "logs");
            if (!Directory.Exists(logsPath)) { ConsecutiveCheckinDays = 0; return; }

            var successfulDays = new HashSet<DateOnly>();
            foreach (var file in Directory.EnumerateFiles(logsPath, "api-reward-*.jsonl"))
            {
                var datePart = Path.GetFileNameWithoutExtension(file).Replace("api-reward-", string.Empty, StringComparison.Ordinal);
                if (!DateOnly.TryParseExact(datePart, "yyyy-MM-dd", out var date)) continue;
                var lines = await File.ReadAllLinesAsync(file);
                if (lines.Any(IsSuccessfulRewardRecord)) successfulDays.Add(date);
            }

            if (successfulDays.Count == 0) { ConsecutiveCheckinDays = 0; return; }
            var cursor = successfulDays.Max();
            var days = 0;
            while (successfulDays.Contains(cursor)) { days++; cursor = cursor.AddDays(-1); }
            ConsecutiveCheckinDays = days;
        }
        catch (Exception ex) { ConsecutiveCheckinDays = 0; AppendLog($"無法計算連續簽到天數：{ex.Message}"); }
    }
    private static bool IsSuccessfulRewardRecord(string line)
    {
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            if (root.TryGetProperty("status", out var status) && status.GetString() is "reward-request-ok" or "reward-request-received") return true;
            if (root.TryGetProperty("rewardBody", out var body) && body.ValueKind == JsonValueKind.Object && body.TryGetProperty("errMsg", out var message)) return message.GetString() == "have rewarded";
        }
        catch (JsonException) { }
        return false;
    }
    private static HttpClient CreateGitHubClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("DigenAutoSign", "1.0"));
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }
    private async Task RefreshGitHubWorkflowAsync()
    {
        const string endpoint = "https://api.github.com/repos/huang1988pioneer/AutoSignDigen/actions/workflows/digen-daily-reward.yml/runs?per_page=100";
        try
        {
            using var document = JsonDocument.Parse(await GitHubClient.GetStringAsync(endpoint));
            var runs = document.RootElement.GetProperty("workflow_runs").EnumerateArray().ToArray();
            if (runs.Length == 0) { WorkflowSummary = "尚無紀錄"; return; }

            var latest = runs[0];
            var conclusion = latest.TryGetProperty("conclusion", out var conclusionValue) ? conclusionValue.GetString() : null;
            var completedAt = latest.TryGetProperty("updated_at", out var updatedValue) && DateTimeOffset.TryParse(updatedValue.GetString(), out var updated) ? updated.ToOffset(TimeSpan.FromHours(8)) : (DateTimeOffset?)null;
            WorkflowSummary = conclusion == "success" ? "success" : conclusion ?? "執行中";
            WorkflowDetail = $"GitHub Actions：{WorkflowSummary} · 完成時間 {completedAt:MM/dd HH:mm} · {latest.GetProperty("html_url").GetString()}";

            var successfulDays = runs
                .Where(run => run.TryGetProperty("conclusion", out var value) && value.GetString() == "success")
                .Select(run => DateTimeOffset.TryParse(run.GetProperty("created_at").GetString(), out var created) ? DateOnly.FromDateTime(created.ToOffset(TimeSpan.FromHours(8)).DateTime) : (DateOnly?)null)
                .Where(date => date.HasValue)
                .Select(date => date!.Value)
                .ToHashSet();
            if (successfulDays.Count == 0) return;
            var cursor = successfulDays.Max();
            var days = 0;
            while (successfulDays.Contains(cursor)) { days++; cursor = cursor.AddDays(-1); }
            ConsecutiveCheckinDays = days;
        }
        catch (Exception ex)
        {
            WorkflowSummary = "同步失敗";
            WorkflowDetail = $"無法讀取 GitHub Actions，已保留本機日誌統計：{ex.Message}";
        }
    }
    private static string? FindWorkspaceRoot()
    {
        foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory }) for (var directory = new DirectoryInfo(start); directory is not null; directory = directory.Parent) if (Directory.Exists(Path.Combine(directory.FullName, "scripts"))) return directory.FullName;
        return null;
    }
    private sealed record ProcessResult(int ExitCode, string Output);
    private sealed class AccountConfig { public List<ConfigAccount>? Accounts { get; init; } }
    private sealed class ConfigAccount { public string? Name { get; init; } public bool Enabled { get; init; } = true; }
}
