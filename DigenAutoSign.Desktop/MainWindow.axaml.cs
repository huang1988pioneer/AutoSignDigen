using Avalonia.Controls;
using Avalonia.Interactivity;
using DigenAutoSign.Desktop.ViewModels;

namespace DigenAutoSign.Desktop;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel(this);
    }
}
