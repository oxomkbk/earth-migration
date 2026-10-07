<div align="center">

# 🌍 THE EARTH MIGRATION PROJECT

### 地球迁移计划 · Humanity's Last Journey

基于 **three.js r160** 的电影级交互式 WebGL 体验：行星发动机、赤道转向阵列、太空电梯，
以及一部讲述地球离开太阳系的影片。
A cinematic, interactive WebGL experience built with three.js r160: planetary engines, a
geostationary space elevator, and a directed film of Earth leaving the Solar System.

![three.js r160](https://img.shields.io/badge/three.js-r160-049EF4)
![Renderer](https://img.shields.io/badge/render-WebGL%20%2B%20GLSL-e91e63)
![Build](https://img.shields.io/badge/build-none%20%2F%20pure%20static-brightgreen)
![Offline](https://img.shields.io/badge/CDN-vendored%20%2F%20offline%20ready-blue)

**[简体中文](#zh) · [English](#en)**

---

## 🤝 友情链接 / Friend Links

| 站点 Site | 链接 Link |
| :--- | :--- |
| 🤖 **Ai 资源网** | <https://human.rlybtd.com/> |

---

## 📸 截图预览 / Screenshots

**① 全球总览 / Global Overview — 行星发动机群、太空电梯与电影视角 HUD**

![全球总览：行星发动机群、太空电梯与电影视角 HUD](screenshot/1.png)

**② 天枢空间站 / Tianshu Apex Station — 太空电梯同步轨道终点，双反向旋转重力环**

![天枢空间站：太空电梯同步轨道终点，双反向旋转重力环](screenshot/2.png)

**③ 天枢空间站 · 近景 / Tianshu Apex Station, close-up — 背景为土星，远处是柯伊伯-7 采矿平台**

![天枢空间站近景，背景为土星](screenshot/3.png)

**④ 极光号居住环 / Habitat Ring Aurora — 120 万居民的轨道殖民地**

![极光号居住环：120 万居民的轨道殖民地](screenshot/4.png)

**⑤ 深空通信阵列 / Deep Space Array — 通往比邻星中继链的激光上行链路**

![深空通信阵列：通往比邻星中继链的激光上行链路](screenshot/5.png)

**⑥ 月球 / Luna — 整个旅程中保持束缚轨道的引力护航**

![月球：整个旅程中保持束缚轨道的引力护航](screenshot/6.png)

*截图均为原始画质 PNG（3360 × 1924，未压缩），点击图片可查看原图。 · Screenshots are full-quality PNGs (3360 × 1924, uncompressed) — click any image to open the original.*

</div>

---

<a id="zh"></a>

## 🇨🇳 中文说明

### 项目简介

**The Earth Migration Project（地球迁移计划）** 是一个纯前端的**电影级交互式 WebGL 体验**，灵感源自《流浪地球》：2061 年，太阳即将熄灭，人类在地球上建造了上万台行星发动机，推动整个星球离开太阳系，前往 4.24 光年外的比邻星——一段两千五百年、上百代人的旅程。

整个程序使用 **three.js r160** 实时渲染，场景比例约为 **1 单位 ≈ 63.7 km**（地球半径 100 单位），建筑与结构刻意放大以便在轨道视角可读。无需构建工具、无需 CDN——three.js 及全部资源均已内置，克隆仓库、起一个静态服务器即可运行，**完全可离线**。

### 两种体验模式

#### ▶ 观看影片（Watch the Journey）

一部 **约 62 秒的“导演影片”**：六幕分镜、运镜、字幕、程序化配乐与点火音效全部由代码实时驱动，支持暂停 / 拖动进度条 / 跳章。

| 幕 | 标题 | 时间线 | 内容 |
| :--- | :--- | :--- | :--- |
| 01 | The Dying Sun · 垂死的太阳 | 2061 | 太阳急剧膨胀，人类决定带着地球一起走 |
| 02 | Ignition · 点火 | 第 0 年 | 上万台行星发动机逐洲点亮，威尔逊凝聚云穹与地面尘埃环扩散 |
| 03 | Turning the World · 刹住地球 | 第 0 年 · 第 3 天 | 赤道转向发动机启动，地球 45 亿年来第一次停止自转 |
| 04 | The Space Elevator · 太空电梯 | 第 1 年 | 镜头沿 36,000 km 缆绳从赤道一路爬上同步轨道的天枢空间站 |
| 05 | Jupiter · 木星 | 第 17 年 | 借助木星引力弹弓甩出太阳系 |
| 06 | The Long Night · 长夜 | 第 2500 年 | 地球冰封，发动机依旧燃烧，飞向比邻星 |

#### 🧭 自由探索（Explore Freely）

拖拽环绕、滚轮缩放、**点击任意建筑直接飞抵**；数字键 `1`–`9` 一键跳转地标；`F` 进入第一人称飞行；`C` 电影巡航模式（自动环游全部地标）；`O` 返回自由探索。

| 按键 | 地标 | 说明 |
| :--- | :--- | :--- |
| `1` | EARTH · 地球总览 | 行星发动机网络全景 |
| `2` | ENGINE ARRAY 017 · 发动机集群 | 19 台重聚变主发动机，11,000 km 等离子光柱 |
| `3` | EQUATORIAL STEERING ARRAY · 赤道转向阵列 | 环赤道转向发动机，负责停止与调整自转 |
| `4` | EQUATORIAL ANCHOR · 电梯锚点 | 太空电梯赤道地基（0.0°N，22.0°E） |
| `5` | TIANSHU APEX STATION · 天枢空间站 | 电梯同步轨道终点，双反向旋转重力环（0.92 g） |
| `6` | HABITAT RING AURORA · 极光号居住环 | 120 万居民的轨道殖民地（0.95 g 旋转重力） |
| `7` | KUIPER-7 MINING PLATFORM · 柯伊伯-7 采矿平台 | 为聚变发动机开采重元素矿石 |
| `8` | DEEP SPACE ARRAY · 深空通信阵列 | 通往比邻星中继链的激光上行链路 |
| `9` | LUNA · 月球 | 引力护航，全程保持束缚轨道 |

### 实时模拟与渲染技术

- **行星发动机网络**：2,200 台实例化渲染的发动机布满各大洲（移动端 900 台），其中 19 台主角级重聚变发动机喷出 11,000 km 的等离子光柱；发动机经程序化建模后由 `GLTFExporter` 内存导出再重新加载，以便统一走 glTF 管线。
- **体积等离子光柱**（`fx/volplume.js`）：逐像素 ray-marching 湍流喷射——白热核心、喉部马赫环、蓝→紫冷却外壳，加性混合、任意顺序合成。
- **发动机尾烟**（`fx/smoke.js`）：受太阳与等离子光柱双侧照明的 billboard 烟团，从导流槽涌出并沿地面翻滚；光柱底部另有蒸汽鞘套。
- **点火冲击波**（`fx/shock.js`）：威尔逊凝聚云穹 + 沿地面外滚的尘埃环，可放置在任意发动机/转向阵列处。
- **物理大气**（`fx/atmosphere.js`）：Rayleigh + Mie 单次散射逐像素 ray-marching（Nishita 模型）——蓝色地平线弧光、晨昏线红橙带、日冕辉光，从地面看就是整个天空穹顶。
- **行星尺度空气透视**（`fx/aerial.js`）：把 three.js 的雾替换为感知地球曲率与太阳高度角的散射模型，接入所有受光材质。
- **三平面 PBR 材质**（`fx/triplanar.js`）：Poly Haven 扫描纹理组（反照率 / 法线 / ARM）按物体空间三轴投影混合，无需 UV，支持 InstancedMesh；再叠加窗口灯光作为尺寸参照。
- **真实星空**：NASA *Deep Star Maps 2020*（Gaia DR2 / Hipparcos-2 / Tycho-2）银河全景 + 恒星点云。
- **NASA 硬件模型**（`fx/models.js`）：国际空间站、哈勃望远镜、移动发射平台（glTF + Draco），合并材质后实例化，几十份拷贝依然廉价。
- **昼夜地球**：NASA Blue Marble / Black Marble 派生贴图（昼面、夜面城市灯光、云层、高光海洋、凹凸与粗糙度），加载失败时自动退化为程序化生成的行星。
- **后期管线**：ACES 色调映射、UnrealBloom 泛光、MSAA；按 `G` 一键切换重特效（低端机友好）。
- **程序化配乐**：Web Audio API 实时合成的环境音乐与点火 / 碎裂音效（响应用户点击后启动，遵循浏览器自动播放策略），随章节切换情绪。
- **活的 HUD**：日心距离、速度、飞行相位、黄道经纬度、发动机出力与各大洲负载、电梯爬升器与缆绳张力、木星交会倒计时、旅程完成度……全部由模拟状态实时驱动，并附轨迹示意图（螺旋加速 + 木星弹弓）。
- **健壮性**：`boot.js` 看门狗——用 `file://` 打开、WebGL 不可用、脚本出错都会给出明确红色提示，而不是永远停在加载页；世界由固定随机种子（`mulberry32(2075)`）驱动，每次加载完全一致。

### 运行方式

ES Modules 与本地资源必须通过 HTTP 访问（直接双击 `index.html` 无法运行）：

```bash
git clone https://github.com/oxomkbk/earth-migration.git
cd earth-migration
python3 serve.py            # → http://localhost:8080（可指定端口：python3 serve.py 9000）
```

其他任意静态服务器也可以，例如 `npx http-server -c-1 .`。

> 要求：现代桌面浏览器（Chrome / Edge / Firefox / Safari），支持 WebGL2，独立 GPU 体验最佳；移动端会自动切换低画质档位。

### 操作按键

| 按键 | 作用 |
| :--- | :--- |
| 鼠标拖拽 / 滚轮 | 环绕 / 缩放 |
| 点击建筑 | 飞往该结构 |
| `1` – `9` | 跳转地标 |
| `C` / `O` / `F` | 电影巡航 / 自由探索 / 第一人称 |
| 第一人称：`W A S D` + `E`/`Space` 升 + `Q`/`Ctrl` 降，`Shift` 加速，`Esc` 退出 | |
| `J` | 播放整部影片 |
| `H` / `G` | 隐藏 HUD / 切换重特效 |
| 影片中：`Space` 暂停 · `←`/`→` 跳章 · `M` 声音 · `Esc` 退出 | |

### 目录结构

| 路径 | 说明 |
| :--- | :--- |
| `index.html` | 页面外壳、HUD 与影片 UI |
| `css/app.css` | 全部样式 |
| `js/boot.js` | 加载看门狗（上报 CDN / WebGL / 脚本错误） |
| `js/app.js` | 场景、模拟、相机、观影导演、HUD 主逻辑 |
| `js/fx/triplanar.js` | 无 UV 几何体的三平面 PBR + 窗口灯光 |
| `js/fx/volplume.js` | 体积等离子光柱（ray-marching） |
| `js/fx/smoke.js` | 导流槽尾烟与光柱蒸汽 |
| `js/fx/shock.js` | 点火冲击波（凝聚云穹 + 尘埃环） |
| `js/fx/atmosphere.js` | Rayleigh + Mie 散射大气（弧光 / 晨昏线 / 天空） |
| `js/fx/aerial.js` | 行星尺度空气透视（所有受光材质的大气雾） |
| `js/fx/models.js` | glTF / Draco 加载与 NASA 模型实例化 |
| `vendor/three/` | three.js r160 构建与用到的 addons（无需 CDN） |
| `assets/` | 星空、贴图与模型（见致谢） |
| `screenshot/` | README 截图（原始画质） |
| `tools/convert-sky.html` | 一次性转换工具：NASA EXR 星图 → `assets/sky/` |

---

<a id="en"></a>

## 🇬🇧 English

### About

**The Earth Migration Project** is a fully front-end, **cinematic interactive WebGL experience** inspired by *The Wandering Earth*: in 2061 the Sun is dying, so humanity builds thousands of planetary engines and pushes the entire planet out of the Solar System toward Proxima Centauri, 4.24 light-years away — a 2,500-year voyage spanning a hundred generations.

Everything is rendered in real time with **three.js r160** at a scale of roughly **1 unit ≈ 63.7 km** (Earth radius = 100 units); structures are deliberately exaggerated so they read from orbit. No build step, no CDN — three.js and every asset are vendored, so cloning the repo and starting any static server is enough. **Works fully offline.**

### Two ways in

#### ▶ Watch the Journey

A **~62-second directed film**: six chapters of camera work, subtitles, a procedural score and ignition SFX — all driven by code in real time. Pause, scrub and skip chapters at will (see the chapter table in the Chinese section above: *The Dying Sun → Ignition → Turning the World → The Space Elevator → Jupiter → The Long Night*).

#### 🧭 Explore Freely

Drag to orbit, scroll to zoom, **click any structure to fly there**; keys `1`–`9` jump between nine landmarks (Earth overview, Engine Array 017, Equatorial Steering Array, Equatorial Anchor, Tianshu Apex Station, Habitat Ring Aurora, Kuiper-7 Mining Platform, Deep Space Array, Luna). `F` enters first-person flight, `C` is an automatic cinematic tour, `O` returns to free exploration.

### Simulation & rendering highlights

- **2,200 instanced planetary engines** (900 on mobile) covering the continents; 19 hero heavy-fusion engines with 11,000 km plasma plumes; engine geometry is built procedurally, round-tripped through `GLTFExporter` in memory and reloaded so it flows through the glTF pipeline.
- **Volumetric plasma plumes** (`fx/volplume.js`): per-pixel ray-marched turbulent jets — white-hot core, Mach diamonds at the throat, a blue→violet cooling sheath; additive emission, order-independent.
- **Exhaust smoke** (`fx/smoke.js`): billboard puffs lit by both the Sun and the adjacent plume, billowing out of the flame trenches and rolling across the ground; a steam sheath boils around the plume bases.
- **Ignition shockwave** (`fx/shock.js`): a Wilson condensation dome plus a dust ring rolling outward, placeable at any engine or steering array.
- **Physically based atmosphere** (`fx/atmosphere.js`): single-scattering Rayleigh + Mie, ray-marched per pixel (Nishita model) — the blue limb, the red-orange terminator band, the solar glow, and the entire sky dome when seen from the ground.
- **Planet-aware aerial perspective** (`fx/aerial.js`): replaces three.js fog on every lit material with a scattering model that respects the planet's curvature and sun elevation.
- **Triplanar PBR** (`fx/triplanar.js`): Poly Haven scanned texture sets (albedo / normal / ARM) projected along object-space axes with no UVs, InstancedMesh-aware; window lights double as a scale cue.
- **Real star sky**: NASA *Deep Star Maps 2020* (Gaia DR2 / Hipparcos-2 / Tycho-2) Milky Way panorama plus a star point cloud.
- **NASA hardware** (`fx/models.js`): ISS, Hubble and the Mobile Launcher (glTF + Draco), material-merged and instanced so dozens of copies stay cheap.
- **Day/night Earth**: NASA Blue Marble / Black Marble derived maps (day, night city lights, clouds, specular ocean, bump/roughness) with a procedural planet as fallback.
- **Post pipeline**: ACES filmic tone mapping, UnrealBloom, MSAA; `G` toggles heavy effects on weaker machines.
- **Procedural score**: ambient music and boom/crack SFX synthesised live with the Web Audio API, changing mood per chapter.
- **A living HUD**: heliocentric distance, velocity, flight phase, engine output and per-continent load, elevator climbers and cable tension, Jupiter encounter countdown, voyage progress — all driven by the simulation, with a trajectory mini-diagram (spiral + Jupiter assist).
- **Robustness**: the `boot.js` watchdog reports `file://` usage, missing WebGL or script errors as clear red messages instead of an endless loader; the world is generated from a fixed seed (`mulberry32(2075)`) so every load is identical.

### Run it

ES modules and local assets must be served over HTTP (opening `index.html` from disk will not work):

```bash
git clone https://github.com/oxomkbk/earth-migration.git
cd earth-migration
python3 serve.py            # → http://localhost:8080  (custom port: python3 serve.py 9000)
```

Any static server works too, e.g. `npx http-server -c-1 .`

> Requires a modern desktop browser with WebGL2 (a discrete GPU is recommended); mobile devices automatically switch to a lower quality profile.

### Controls

| Input | Action |
| :--- | :--- |
| Drag / scroll | Orbit / zoom |
| Click a structure | Fly there |
| `1` – `9` | Jump to a landmark |
| `C` / `O` / `F` | Cinematic tour / Explore / First person |
| First person: `W A S D`, `E`/`Space` up, `Q`/`Ctrl` down, `Shift` sprint, `Esc` exit | |
| `J` | Play the film |
| `H` / `G` | Hide HUD / toggle heavy effects |
| In the film: `Space` pause · `←`/`→` chapters · `M` sound · `Esc` exit | |

### Project layout

| Path | What |
| :--- | :--- |
| `index.html` | page shell, HUD and film UI markup |
| `css/app.css` | styles |
| `js/boot.js` | loader watchdog (reports CDN / WebGL / script failures) |
| `js/app.js` | scene, simulation, camera, viewing-mode director, HUD |
| `js/fx/triplanar.js` | triplanar PBR for UV-less geometry + window lights |
| `js/fx/volplume.js` | ray-marched volumetric plasma plumes |
| `js/fx/smoke.js` | flame-trench exhaust clouds and plume steam |
| `js/fx/shock.js` | ignition shockwave (condensation dome + dust ring) |
| `js/fx/atmosphere.js` | Rayleigh + Mie atmosphere (limb / terminator / sky) |
| `js/fx/aerial.js` | planet-aware aerial perspective on all lit materials |
| `js/fx/models.js` | glTF/Draco loading and instancing of the NASA models |
| `vendor/three/` | three.js r160 build + the addons used (no CDN needed) |
| `assets/` | sky, textures and models (see credits) |
| `screenshot/` | README screenshots (full quality) |
| `tools/convert-sky.html` | one-off converter: NASA EXR star maps → `assets/sky/` |

---

## 📄 素材来源与致谢 / Credits

- **Sky 星空**： NASA/Goddard Space Flight Center Scientific Visualization Studio, *Deep Star Maps 2020* (Gaia DR2, Hipparcos-2, Tycho-2) — public domain. 银河全景与星表由 `milkyway_2020_4k.exr` 和 `hiptyc_2020_8k.exr` 派生。
- **Models 模型**： NASA 3D Resources (github.com/nasa/NASA-3D-Resources) — International Space Station (B), Hubble Space Telescope (A), Mobile Launcher. Public domain; NASA does not endorse this project.
- **Textures 贴图**： Poly Haven (polyhaven.com) — metal_plate_02, painted_metal_shutter, gray_rocks, blue_metal_plate, aerial_ground_rock. CC0.
- **Earth / Moon maps 地月贴图**： three.js example textures (NASA Blue Marble / Black Marble derived), MIT-licensed repository, vendored in `assets/earth/`; a procedural planet is generated if they fail to load.
- **Fonts 字体**： Orbitron, Rajdhani, JetBrains Mono (Google Fonts, OFL).

<div align="center">

🤝 友情链接 / Friend Links: **[Ai 资源网](https://human.rlybtd.com/)**

</div>
