BEYOND THE WANDERING EARTH — Wallpaper Engine edition
=====================================================

A real-time WebGL (three.js) wallpaper: the planetary engines ignite, then the camera travels through the
space elevators, the geostationary ring, the escort fleet, the Sun, Jupiter, Saturn, interstellar space and
the Milky Way to a new sun at Alpha Centauri. Everything is in this folder; it needs no internet connection.


1. TRY IT LOCALLY
-----------------
Wallpaper Engine → "Open Wallpaper" (bottom left) → "Open from File" → choose index.html in this folder.
(Or copy the whole folder into  <Steam>\steamapps\common\wallpaper_engine\projects\myprojects\
 and it appears in your Installed list.)


2. PUBLISH ON THE STEAM WORKSHOP
--------------------------------
1. Copy this folder into  <Steam>\steamapps\common\wallpaper_engine\projects\myprojects\
2. Start Wallpaper Engine → "Wallpaper Editor" → "Open Wallpaper" → pick this project.
   (Alternatively: Wallpaper Editor → "Create Wallpaper" → drop index.html; then copy project.json's
    "general" block over the generated one to keep all the settings.)
3. In the editor: Workshop → "Share Wallpaper on Workshop". Title, description, tags, preview and the
   user properties come from project.json; check them, choose the visibility, accept the agreement, publish.
   Wallpaper Engine writes the Workshop id back into project.json. Keep that copy for later updates.


3. MODES AND THE CONTROL PANEL
------------------------------
The control panel lives at the top edge (top right by default) and starts collapsed: only a small, dim
menu icon is visible. Click the icon to open it; click it again, the panel's X, or anywhere outside the panel to
close it; it also closes by itself after 5 s without use. Hovering or moving the mouse never opens it.
If your Wallpaper Engine set-up does not pass clicks to the wallpaper, use the setting "Open the control panel"
(every panel option also exists as a setting). A top taskbar: raise "Panel extra top offset".
Clicks on empty desktop space do nothing — the film plays ONLY when you press the Play button.

  LANDING    the Earth and its burning engines. The camera glides between three views as the cursor moves
             (left third: low beside the array · centre: hero view · right third: high orbit), or pin one
             (CAMERA: FOLLOW CURSOR / LOW / HERO / ORBIT). Rest the mouse and it settles and drifts slowly.
  INSPECT    orbit a hero asset (ENGINES, ELEVATOR, STATION, FLAGSHIP, STEERING, EARTH, MOON, SATURN, SUN):
             drag to orbit, wheel to zoom; it rotates slowly when you leave it alone.
  CINEMATIC  the film on its scripted camera. Play / pause, restart from the countdown, jump to a chapter.
  FLIGHT     a guided flight past the engines, the elevator, the ring and the fleet: cursor left flies back,
             right flies forward, centre cruises; SLOW / CRUISE / FAST.
  ONE-SHOT / LOOP   one-shot: the film plays once, then the camera returns to the landing view;
                    loop: it restarts from the countdown behind a short dip through black.
  LOW / MED / HIGH / ULTRA   quality, switched live (no reload).
Switching modes is an eased camera flight (a short dip through black only across a big jump in time).
Keyboard (if forwarded): 1-4 modes, arrow keys views / assets / chapters, H panel.


4. SETTINGS (Wallpaper Engine → the wallpaper's properties panel; all applied live)
---------------------------------------------------------------------------------
Default mode (+ "Play the film automatically", opt-in), Loop the film, Interaction sensitivity,
On-screen control panel: open (start expanded), auto-collapse time, position (top right / centre / left), extra top offset, Landing idle timeout, Inspect/flight return-to-landing time,
Auto-play the film after resting (opt-in, 0 = never), Inspect auto-rotate speed, audio reaction, soundtrack,
captions, titles, letterbox, clock (24 h, corner), telemetry, scheme colour, brightness, Quality,
Frame-rate cap, Power saver, Render scale. Panel choices are remembered for the session; settings changes
are mirrored into the panel.


5. PERFORMANCE
--------------
Quality switches live; instance budgets and sky ray-march steps follow the tier at the next start.
Tier     render scale*   MSAA   sun shadow            bloom levels   plume / sky ray-march   default cap
Low      0.75 (≤1.2 MP)  2×     off                   5              10 / 7 steps            30 fps
Medium   1.00 (≤2.1 MP)  4×     1024, every 2nd frame 6              14 / 9                  30 fps
High     1.25 (≤3.3 MP)  4×     2048, every frame     7              18 / 11                 60 fps
Ultra    1.50 (≤5.0 MP)  4×     2048, every frame     7              22 / 12                 60 fps
* render pixels per screen pixel, capped by a pixel budget so 4K screens stay affordable.
If frames arrive late, the wallpaper lowers its own resolution (down to 60 %), then refreshes the shadow
map less often; it recovers slowly when there is headroom. Laptops / integrated GPUs: choose Low.


6. CREDITS / LICENCES
---------------------
three.js (MIT).
Sky: NASA/Goddard SVS Deep Star Maps 2020 (public domain). Milky Way plan view: NASA Goddard / CI Lab (public domain).
Models: NASA 3D Resources, ISS and Hubble (public domain; NASA does not endorse this work).
Planet maps: Solar System Scope (solarsystemscope.com/textures), CC BY 4.0. Pluto: NASA/JHUAPL/SwRI (public domain).
Earth night and relief maps: three.js example textures (NASA Blue Marble / Black Marble derived).
Surface textures: Poly Haven (CC0). Fonts: Orbitron, Rajdhani, JetBrains Mono (SIL Open Font License 1.1).
A fan work inspired by The Wandering Earth; not affiliated with its rights holders.
