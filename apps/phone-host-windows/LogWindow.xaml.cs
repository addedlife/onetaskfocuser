using DeskPhone.ViewModels;
using System.Windows;
using System.Windows.Controls;

namespace DeskPhone;

public partial class LogWindow : Window
{
    public LogWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }

    private void DebugTextBox_TextChanged(object sender, TextChangedEventArgs e)
        => DebugTextBox.ScrollToEnd();

    private void ClearDebugButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
            vm.ClearDebugLog();
    }
}
