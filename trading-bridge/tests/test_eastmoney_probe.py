from trading_bridge.adapters.eastmoney_probe import EastmoneyCapabilityProbe


class FakeUia:
    def __init__(self, snapshot):
        self._snapshot = snapshot
        self.click_calls = []
        self.type_calls = []

    def snapshot(self):
        return self._snapshot


def test_probe_reports_missing_client_without_clicking():
    fake_uia = FakeUia({"processes": [], "windows": []})
    report = EastmoneyCapabilityProbe(fake_uia).probe()
    assert report.process_detected is False
    assert report.safe_for_shadow is False
    assert report.safe_for_live is False
    assert fake_uia.click_calls == []
    assert fake_uia.type_calls == []


def test_probe_redacts_account_numbers_and_hashes_executable_path():
    fake_uia = FakeUia({
        "processes": [{
            "name": "mainfree.exe",
            "executable_path": "C:/broker/3375523495/mainfree.exe",
            "product_version": "10.20.30",
        }],
        "windows": [{
            "title": "东方财富交易 - 账号 3375523495",
            "control_type": "Window",
            "automation_id": "main-window",
            "texts": ["可用资金 7000.00", "持仓", "委托", "撤单", "3375523495"],
            "is_dialog": False,
        }],
    })
    report = EastmoneyCapabilityProbe(fake_uia).probe()
    dumped = str(report.model_dump())
    assert "3375523495" not in dumped
    assert "C:/broker" not in dumped
    assert report.executable_path_hash is not None
    assert report.funds_view_readable is True
    assert report.positions_view_readable is True
    assert report.orders_view_readable is True
    assert report.cancel_control_readable is True
    assert report.safe_for_shadow is True


def test_unknown_modal_dialog_prevents_shadow_safety():
    fake_uia = FakeUia({
        "processes": [{"name": "mainfree.exe", "executable_path": None, "product_version": None}],
        "windows": [
            {"title": "东方财富交易", "control_type": "Window", "texts": ["持仓"], "is_dialog": False},
            {"title": "未知安全确认 123456", "control_type": "Window", "texts": [], "is_dialog": True},
        ],
    })
    report = EastmoneyCapabilityProbe(fake_uia).probe()
    assert report.safe_for_shadow is False
    assert report.unknown_dialogs == ["未知安全确认 [REDACTED]"]


def test_eastmoney_main_window_is_not_treated_as_unknown_dialog():
    fake_uia = FakeUia({
        "processes": [{"name": "mainfree.exe", "executable_path": None, "product_version": None}],
        "windows": [{
            "title": "Eastmoney Terminal",
            "control_type": "Window",
            "class_name": "MainFrame",
            "texts": [],
            "is_dialog": True,
            "is_modal": False,
        }],
    })

    report = EastmoneyCapabilityProbe(fake_uia).probe()

    assert report.unknown_dialogs == []
    assert report.safe_for_shadow is True


def test_explicit_modal_window_is_treated_as_unknown_dialog():
    fake_uia = FakeUia({
        "processes": [{"name": "mainfree.exe", "executable_path": None, "product_version": None}],
        "windows": [
            {
                "title": "Eastmoney Terminal",
                "control_type": "Window",
                "class_name": "MainFrame",
                "texts": [],
                "is_modal": False,
            },
            {
                "title": "Security confirmation 123456",
                "control_type": "Window",
                "class_name": "#32770",
                "texts": [],
                "is_modal": True,
            },
        ],
    })

    report = EastmoneyCapabilityProbe(fake_uia).probe()

    assert report.safe_for_shadow is False
    assert report.unknown_dialogs == ["Security confirmation [REDACTED]"]
