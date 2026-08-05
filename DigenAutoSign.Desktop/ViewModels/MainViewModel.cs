using System.Collections.ObjectModel;
using System.Diagnostics;
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
    private string _logText = "歡迎使用。選擇工作區後，即可載入 accounts.json。";
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
        LoginCommand = new RelayCommand(() => _ = RunLoginAsync(), () => CanRunSelected());
        CheckSelectedCommand = new RelayCommand(() => _ = RunCheckinAsync(SelectedAccount), () => CanRunSelected());
        CheckAllCommand = new RelayCommand(() => _ = RunCheckinAsync(null), () => !_isRunning && Accounts.Any(x => x.Enabled));
        ClearLogCommand = new RelayCommand(() => LogText = string.Empty);
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

    public string WorkspaceRoot
    {
        get => _workspaceRoot;
        set { if (SetProperty(ref _workspaceRoot, value)) _ = ReloadAsync(); }
    }
    public string Browser { get => _browser; set => SetProperty(ref _browser, value); }
    public string Status { get => _status; private set => SetProperty(ref _status, value); }
    public string LogText { get => _logText; private set => SetProperty(ref _logText, value); }
    public AccountEntry? SelectedAccount
    {
        get => _selectedAccount;
        set
        {
            if (SetProperty(ref _selectedAccount, value))
            {
                OnPropertyChanged(nameof(HasSelectedAccount));
                RaiseCommandStates();
            }
        }
    }
    public bool HasSelectedAccount => SelectedAccount is not null;

    private bool CanRunSelected() => !_isRunning && SelectedAccount is not null;

    private async Task BrowseWorkspaceAsync()
    {
        var folders = await _window.StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
        {
            Title = "選擇 Digen Auto Sign 專案資料夾",
            AllowMultiple = false
        });
        if (folders.Count > 0 && folders[0].TryGetLocalPath() is { } path)
            WorkspaceRoot = path;
    }

    private async Task ReloadAsync()
    {
        try
        {
            var path = Path.Combine(WorkspaceRoot, "accounts.json");
            if (!File.Exists(path))
            {
                Accounts.Clear();
                Status = "找不到 accounts.json";
                AppendLog("找不到 accounts.json。請先從 accounts.example.json 複製建立設定檔。");
                return;
            }
            var config = JsonSerializer.Deserialize<AccountConfig>(await File.ReadAllTextAsync(path), JsonOptions())
                ?? throw new InvalidDataException("accounts.json 格式無效。");
            Accounts.Clear();
            foreach (var account in config.Accounts ?? [])
                Accounts.Add(new AccountEntry { Name = account.Name ?? "", Enabled = account.Enabled });
            Status = $"已載入 {Accounts.Count} 個帳號";
            AppendLog($"已載入 {path}");
        }
        catch (Exception ex)
        {
            Status = "設定載入失敗";
            AppendLog($"設定載入失敗：{ex.Message}");
        }
        RaiseCommandStates();
    }

    private void AddAccount()
    {
        var number = 1;
        while (Accounts.Any(x => x.Name.Equals($"account{number}", StringComparison.OrdinalIgnoreCase))) number++;
        var account = new AccountEntry { Name = $"account{number}" };
        Accounts.Add(account);
        SelectedAccount = account;
        Status = "已新增帳號，請修改名稱後儲存";
    }

    private void RemoveAccount()
    {
        if (SelectedAccount is null) return;
        Accounts.Remove(SelectedAccount);
        SelectedAccount = Accounts.FirstOrDefault();
        Status = "已從畫面移除帳號，請儲存設定";
    }

    private async Task SaveAsync()
    {
        try
        {
            if (Accounts.Any(x => string.IsNullOrWhiteSpace(x.Name)))
                throw new InvalidDataException("帳號名稱不可空白。");
            if (Accounts.GroupBy(x => x.Name, StringComparer.OrdinalIgnoreCase).Any(x => x.Count() > 1))
                throw new InvalidDataException("帳號名稱不可重複。");
            var path = Path.Combine(WorkspaceRoot, "accounts.json");
            var config = new AccountConfig { Accounts = Accounts.Select(x => new ConfigAccount { Name = x.Name.Trim(), Enabled = x.Enabled }).ToList() };
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(config, JsonOptions()));
            Status = "設定已儲存";
            AppendLog($"已儲存 {path}");
        }
        catch (Exception ex)
        {
            Status = "設定未儲存";
            AppendLog($"儲存失敗：{ex.Message}");
        }
    }

    private async Task RunLoginAsync()
    {
        if (SelectedAccount is null) return;
        await RunNodeAsync("login.js", $"{Quote(SelectedAccount.Name)} --browser={Browser}", SelectedAccount);
    }

    private async Task RunCheckinAsync(AccountEntry? account)
    {
        var arguments = account is null ? $"--browser={Browser}" : $"{Quote(account.Name)} --browser={Browser}";
        await RunNodeAsync("api-reward.js", arguments, account);
    }

    private async Task RunNodeAsync(string script, string arguments, AccountEntry? account)
    {
        var scriptPath = Path.Combine(WorkspaceRoot, "scripts", script);
        if (!File.Exists(scriptPath))
        {
            AppendLog($"找不到腳本：{scriptPath}");
            Status = "無法執行";
            return;
        }
        SetRunning(true, account is null ? "正在執行全部啟用帳號" : $"正在執行 {account.Name}");
        AppendLog($"> node scripts/{script} {arguments}");
        try
        {
            var result = await ExecuteProcessAsync("node", $"{Quote(scriptPath)} {arguments}", WorkspaceRoot);
            AppendLog(result.Output);
            var success = result.ExitCode == 0;
            if (account is not null) account.Result = success ? "完成" : "需處理";
            Status = success ? "執行完成" : $"命令結束（代碼 {result.ExitCode}）";
        }
        catch (Exception ex)
        {
            if (account is not null) account.Result = "執行失敗";
            Status = "執行失敗";
            AppendLog($"執行失敗：{ex.Message}\n請確認已安裝 Node.js，並在工作區執行過 npm install。");
        }
        finally { SetRunning(false, Status); }
    }

    private static async Task<ProcessResult> ExecuteProcessAsync(string fileName, string arguments, string workingDirectory)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(fileName, arguments)
        {
            WorkingDirectory = workingDirectory, UseShellExecute = false, RedirectStandardOutput = true,
            RedirectStandardError = true, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        }};
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return new ProcessResult(process.ExitCode, (await stdout + Environment.NewLine + await stderr).Trim());
    }

    private void SetRunning(bool running, string status)
    {
        _isRunning = running;
        Status = status;
        RaiseCommandStates();
    }
    private void RaiseCommandStates()
    {
        RemoveAccountCommand.RaiseCanExecuteChanged(); LoginCommand.RaiseCanExecuteChanged();
        CheckSelectedCommand.RaiseCanExecuteChanged(); CheckAllCommand.RaiseCanExecuteChanged();
    }
    private void AppendLog(string value) => LogText = $"[{DateTime.Now:HH:mm:ss}] {value.Trim()}\n\n{LogText}";
    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";
    private static JsonSerializerOptions JsonOptions() => new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private static string? FindWorkspaceRoot()
    {
        foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
        {
            for (var directory = new DirectoryInfo(start); directory is not null; directory = directory.Parent)
                if (Directory.Exists(Path.Combine(directory.FullName, "scripts"))) return directory.FullName;
        }
        return null;
    }

    private sealed record ProcessResult(int ExitCode, string Output);
    private sealed class AccountConfig { public List<ConfigAccount>? Accounts { get; init; } }
    private sealed class ConfigAccount { public string? Name { get; init; } public bool Enabled { get; init; } = true; }
}
