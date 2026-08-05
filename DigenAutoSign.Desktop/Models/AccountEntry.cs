using DigenAutoSign.Desktop.ViewModels;

namespace DigenAutoSign.Desktop.Models;

public sealed class AccountEntry : ObservableObject
{
    private string _name = "new-account";
    private bool _enabled = true;
    private string _result = "等待執行";

    public string Name { get => _name; set => SetProperty(ref _name, value); }
    public bool Enabled { get => _enabled; set => SetProperty(ref _enabled, value); }
    public string Result { get => _result; set => SetProperty(ref _result, value); }
    public string Detail => Enabled ? "已啟用，可執行簽到" : "已停用";
}
