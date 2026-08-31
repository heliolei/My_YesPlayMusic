/* global __static */
import path from 'path';
import { app, nativeImage, Tray, Menu, nativeTheme } from 'electron';
import { isLinux } from '@/utils/platform';

// menu-dark/light@88.png 是纯剪影（为 macOS 菜单栏的 template image 规范准备的）。
// Linux 桌面的面板（GNOME 顶栏、KDE 任务栏）无论系统是浅色还是深色主题都是深色底，
// 按 nativeTheme 推出来的 'dark' 剪影贴上去就是黑底黑图，所以 Linux 下 auto 用彩色图标。
function resolveTrayIconTheme(store) {
  const trayIconSetting = store.get('settings.trayIconTheme') || 'auto';
  if (trayIconSetting !== 'auto') return trayIconSetting;
  if (isLinux) return 'color';
  return nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
}

function createTrayIcon(store) {
  const iconTheme = resolveTrayIconTheme(store);
  return nativeImage
    .createFromPath(path.join(__static, `img/icons/menu-${iconTheme}@88.png`))
    .resize({
      height: 20,
      width: 20,
    });
}

// GNOME Shell / KDE 把 indicator 的右键菜单画成深色底（本机实测 #36363A），
// 而 play/pause/... 这 8 个 16x16 字形是纯黑的，贴上去对比度只有约 1.7:1，基本看不见。
// Linux 下换成同形状的白色字形 *-light.png（只把 RGB 置白，alpha 逐像素不变）。
const MENU_ICON_SUFFIX = isLinux ? '-light' : '';

function menuItemIcon(name) {
  return nativeImage.createFromPath(
    path.join(__static, `img/icons/${name}${MENU_ICON_SUFFIX}.png`)
  );
}

function createMenuTemplate(win) {
  return [
    {
      label: '播放',
      icon: menuItemIcon('play'),
      click: () => {
        win.webContents.send('play');
      },
      id: 'play',
    },
    {
      label: '暂停',
      icon: menuItemIcon('pause'),
      click: () => {
        win.webContents.send('play');
      },
      id: 'pause',
      visible: false,
    },
    {
      label: '上一首',
      icon: menuItemIcon('left'),
      accelerator: 'CmdOrCtrl+Left',
      click: () => {
        win.webContents.send('previous');
      },
    },
    {
      label: '下一首',
      icon: menuItemIcon('right'),
      accelerator: 'CmdOrCtrl+Right',
      click: () => {
        win.webContents.send('next');
      },
    },
    {
      label: '循环播放',
      icon: menuItemIcon('repeat'),
      accelerator: 'Alt+R',
      click: () => {
        win.webContents.send('repeat');
      },
    },
    {
      label: '加入喜欢',
      icon: menuItemIcon('like'),
      accelerator: 'CmdOrCtrl+L',
      click: () => {
        win.webContents.send('like');
      },
      id: 'like',
    },
    {
      label: '取消喜欢',
      icon: menuItemIcon('unlike'),
      accelerator: 'CmdOrCtrl+L',
      click: () => {
        win.webContents.send('like');
      },
      id: 'unlike',
      visible: false,
    },
    {
      label: '退出',
      icon: menuItemIcon('exit'),
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        app.exit();
      },
    },
  ];
}

// linux下托盘的实现方式比较迷惑
// right-click无法在linux下使用
// click在默认行为下会弹出一个contextMenu，里面的唯一选项才会调用click事件
// setContextMenu应该是目前唯一能在linux下使用托盘菜单api
// 但是无法区分鼠标左右键

// 发现openSUSE KDE环境可以区分鼠标左右键
// 添加左键支持
// 2022.05.17
class YPMTrayLinuxImpl {
  constructor(tray, win, emitter, store) {
    this.tray = tray;
    this.win = win;
    this.emitter = emitter;
    this.store = store;
    this.template = undefined;
    this.initTemplate();
    this.contextMenu = Menu.buildFromTemplate(this.template);

    this.tray.setContextMenu(this.contextMenu);
    this.handleEvents();
  }

  initTemplate() {
    //在linux下，鼠标左右键都会呼出contextMenu
    //所以此处单独为linux添加一个 显示主面板 选项
    this.template = [
      {
        label: '显示主面板',
        click: () => {
          this.win.show();
        },
      },
      {
        type: 'separator',
      },
    ].concat(createMenuTemplate(this.win));
  }

  handleEvents() {
    this.tray.on('click', () => {
      this.win.show();
    });

    this.emitter.on('updateTooltip', title => this.tray.setToolTip(title));
    this.emitter.on('updatePlayState', isPlaying => {
      this.contextMenu.getMenuItemById('play').visible = !isPlaying;
      this.contextMenu.getMenuItemById('pause').visible = isPlaying;
      this.tray.setContextMenu(this.contextMenu);
    });
    this.emitter.on('updateLikeState', isLiked => {
      this.contextMenu.getMenuItemById('like').visible = !isLiked;
      this.contextMenu.getMenuItemById('unlike').visible = isLiked;
      this.tray.setContextMenu(this.contextMenu);
    });
    this.emitter.on('updateIcon', () => {
      this.updateIcon();
    });
  }

  updateIcon() {
    this.tray.setImage(createTrayIcon(this.store));
  }
}

class YPMTrayWindowsImpl {
  constructor(tray, win, emitter, store) {
    this.tray = tray;
    this.win = win;
    this.emitter = emitter;
    this.store = store;
    this.template = createMenuTemplate(win);
    this.contextMenu = Menu.buildFromTemplate(this.template);

    this.isPlaying = false;
    this.curDisplayPlaying = false;

    this.isLiked = false;
    this.curDisplayLiked = false;

    this.handleEvents();
  }

  handleEvents() {
    this.tray.on('click', () => {
      this.win.show();
    });

    this.tray.on('right-click', () => {
      if (this.isPlaying !== this.curDisplayPlaying) {
        this.curDisplayPlaying = this.isPlaying;
        this.contextMenu.getMenuItemById('play').visible = !this.isPlaying;
        this.contextMenu.getMenuItemById('pause').visible = this.isPlaying;
      }

      if (this.isLiked !== this.curDisplayLiked) {
        this.curDisplayLiked = this.isLiked;
        this.contextMenu.getMenuItemById('like').visible = !this.isLiked;
        this.contextMenu.getMenuItemById('unlike').visible = this.isLiked;
      }

      this.tray.popUpContextMenu(this.contextMenu);
    });

    this.emitter.on('updateTooltip', title => this.tray.setToolTip(title));
    this.emitter.on(
      'updatePlayState',
      isPlaying => (this.isPlaying = isPlaying)
    );
    this.emitter.on('updateLikeState', isLiked => (this.isLiked = isLiked));
    this.emitter.on('updateIcon', () => {
      this.updateIcon();
    });
  }

  updateIcon() {
    this.tray.setImage(createTrayIcon(this.store));
  }
}

export function createTray(win, eventEmitter, store) {
  let tray = new Tray(createTrayIcon(store));
  tray.setToolTip('YesPlayMusic');

  return isLinux
    ? new YPMTrayLinuxImpl(tray, win, eventEmitter, store)
    : new YPMTrayWindowsImpl(tray, win, eventEmitter, store);
}
