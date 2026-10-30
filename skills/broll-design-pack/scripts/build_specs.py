"""Regenerates design.json / palette.json / typography.json / motion.json from the values used in components.py + plates."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import components as C
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
hx = lambda c: '#%02X%02X%02X' % tuple(c[:3])

palette = {
  'core': {'CREAM': hx(C.CREAM), 'INK': hx(C.INK), 'CORAL_punch': hx(C.CORAL), 'CHAR_near_black': hx(C.CHAR), 'LINE_divider': hx(C.LINE),
           'GREYT_secondary_text': hx(C.GREYT), 'WHITE': hx(C.WHITE), 'STUB_placeholder': hx(C.STUB), 'STUB_LIGHT': hx(C.STUB_LIGHT),
           'SHADOW_tint': hx(C.SHADOW_RGB)},
  'accents': {'TERRA': hx(C.TERRA), 'EMER': hx(C.EMER), 'COBALT': hx(C.COBALT), 'BLUE': hx(C.BLUE), 'PINK': hx(C.PINK), 'GOLD': hx(C.GOLD),
              'PURPLE': hx(C.PURPLE), 'ORANGE': hx(C.ORANGE), 'GREEN': hx(C.GREEN)},
  'ui_misc': {'traffic_red': '#E85846', 'traffic_yellow': '#F0B432', 'traffic_green': '#3CBE64', 'status_green': '#3CBE64', 'status_amber': '#F0B432',
              'dark_inner_panel': '#383A42', 'dark_progress_track': '#464850', 'lane_pink_track': '#FFC8DC', 'ring_blue_181': '#A0BEFF',
              'tray_cell': '#F0E6D6', 'image_block': '#E2D6C4', 'disc_shadow': '#00000040 (alpha 60)'},
  'stages_radial_gradient': {k: {'centre': hx(a), 'edge': hx(b)} for k, (a, b) in C.STAGES.items()},
  'stage_gradient_formula': 'g = clip(hypot((x-0.45W)/W, (y-0.40H)/H) * 1.25, 0, 1); colour = centre*(1-g) + edge*g',
  'stage_per_plate': {'179': 'terra', '180': 'emer', '181': 'cobalt', '182': 'violet', '183': 'hotpink', '184': 'navy'},
  'rule': 'ONE coral keyword per beat; coral only on cream (never coral text directly on a coloured stage).'}

typography = {
  'family': 'Inter (OTF, bundled in fonts/, SIL OFL)', 'weights_used': {'Black': 'all labels/plaques/cards', 'ExtraBold': 'plaque sub-line only (sub=)'},
  'case': 'ALL CAPS for labels; product names keep their own case (e.g. "Grok Bot", "WhatsApp")',
  'anchor': 'text drawn with anchor "lm" (left-middle) or "mm" (centre-middle); multi-colour runs via draw_parts()',
  'line_height': 'single-line labels only; plaque height = 1.75 × font size; stacked stub rows step 30 px (stubcard) / 50–78 px (lists)',
  'letter_spacing': 'default (0)',
  'scale_px': {'hero_stamp': [64, 72, 84], 'header_plaque': [50, 56, 58], 'beat_label': [40, 42, 44, 46, 50, 52], 'caption_plaque': [44, 46],
               'kicker_small': [26, 28, 30, 32, 34, 36], 'peek_tab': 36, 'card_title': [44, 46, 60], 'disc_label': '0.36 × disc size (110 → 39 px)',
               'window_title': 32},
  'per_plate_sizes': {
    '179': {'MARKETING TEAM BUILT (card)': 60, 'BEFORE': 52, 'EACH BOT': 34, 'MANAGER': 56, 'PLANS': 30, 'TEAM YOU NEED / STILL MUST BE HIRED': 34, '+ slot': 50},
    '180': {'GROUP CHAT (panel title)': 44, 'ONE PLACE (tray tag)': 26, 'ASSIGN WORK': 40, 'PROGRESS REPORTS': 42, 'SAME CHAT': 46},
    '181': {'BUILD FIVE EMPLOYEES': 56, '01–05 discs': 39, 'SHARED MEMORY': 40, 'GROUP': 26, 'EVERYONE SEES PROGRESS': 50},
    '182': {'RESEARCH / CONTENT': 56, 'FINDINGS / POSTS': 32, 'HAND OFF': 30},
    '183': {'MANAGER ASSIGNS / STAFF EXECUTE': 46, 'GROUP CHAT (panel title)': 44, 'SYNCS': 36, 'FULL TASK PROGRESS · WHOLE TEAM': 44},
    '184': {'EVERY STATUS (board title)': 46, 'LEAD': 36, 'MANAGER ACCEPT': 40, 'YOU': 56, 'BEFORE IT COMES TO YOU': 28, 'FAILS REVIEW': 40, 'SEND BACK': 28, 'RIGHT EMPLOYEE': 22, 'FIX': 72}}}

design = {
  'canvas': {'width': 1920, 'height': 1080, 'fps': 30, 'codec': 'H.264 libx264, preset medium, crf 18, yuv420p', 'container': 'MP4'},
  'safe_area': {'title_safe_px': {'x': 96, 'y': 54, 'w': 1728, 'h': 972}, 'action_safe_px': {'x': 48, 'y': 27, 'w': 1824, 'h': 1026},
                'practice': 'headers centred at y≈110–230; bottom captions at y≈960–990; peek tab at (330,1000) intentionally sits in the lower-left corner'},
  'sprite_margin_M': C.M, 'placement': 'all sprites positioned by CENTRE via place(fr, sprite, cx, cy, scale, alpha)',
  'card_defaults': {'card()': {'radius': 34, 'border': 9, 'shadow_opacity': .32, 'shadow_offset_y': 20, 'shadow_blur': 26},
                    'plaque()': {'height': '1.75 × size', 'pad_x': 56, 'radius': 'min(h/2, 60)', 'shadow_opacity': .5, 'shadow_offset_y': 26, 'shadow_blur': 30, 'border': 0},
                    'stubcard()': {'radius': 26, 'shadow_opacity': .45, 'offset_y': 16, 'blur': 20, 'stub_line_h': 14, 'stub_row_step': 30},
                    'darkpanel()': {'radius': 40, 'title_bar_h': 94, 'title_bar_radius': 28, 'shadow': [.6, 30, 36]},
                    'mac()': {'radius': 34, 'traffic_light_d': 18, 'traffic_step': 32, 'shadow': [.6, 30, 36]},
                    'bot()': {'radius': 30, 'visor_radius': 20, 'shadow': [.45, 16, 20]},
                    'disc()': {'diameter': 110, 'shadow_offset': 6}},
  'components_by_plate': {
    '179': {'team_card': [820, 360, 44], 'bot_card': [240, 170, 30], 'plan_slot': [280, 84, 26], 'hire_slot_dashed': [280, 84, 'dashed 5px']},
    '180': {'chat_panel': [900, 660, 40], 'one_place_tray': [780, 150, 26], 'task_chip': [200, 70, 26], 'progress_card': [560, 110, 26]},
    '181': {'disc': [110, 110, 55], 'ring': {'centre': [960, 540], 'rx': 340, 'ry': 279}, 'progress_bar': [120, 14, 7]},
    '182': {'finding_card': [420, 100, 26], 'post_card': [420, 100, 26]},
    '183': {'lane_track': [800, 12, 6], 'token': [150, 60, 26], 'sync_panel': [640, 620, 40], 'progress_bar': [540, 24, 12]},
    '184': {'status_board': [560, 560, 40], 'status_pill': [488, 56, 28], 'token': [150, 64, 26], 'you_card': [240, 150, 32], 'employee_card': [300, 120, 30]}},
  'size_format': '[width, height, radius] in px (content box, excluding the M=90 shadow margin)',
  'strokes': {'dashed_line': {'width': '4–6', 'dash': 18, 'gap': 14, 'colour': 'CREAM (or CORAL for send-back)'}, 'strike': 14, 'arrow_head': 24},
  'rules': ['faceless, no people illustrations, no logos', 'blank stubs only – never invented names/numbers/copy', 'black capsules never as hero', 'no camera moves; impacts use jolt() 2–4 px for 0.10–0.20 s']}

def L(layer, t_in, dur, ease, frm, to, out=None, **kw):
    d = {'layer': layer, 'in': t_in, 'duration': dur, 'easing': ease, 'from': frm, 'to': to, 'out': out or 'holds to end of plate'}
    d.update(kw); return d
TABIN = lambda label, to: L(f'peek tab "{label}" (match-cut IN)', 0.05, 0.30, 'eio', {'pos': [330, 1000], 'scale': .8, 'alpha': 1}, {'pos': to, 'alpha': 0}, 'gone at 0.35s')
PEEK = lambda label, t: L(f'peek tab "{label}" (E-beat soft handoff)', t, 0.60, 'eoc', {'pos': [-260, 1000], 'scale': .8}, {'pos': [330, 1000], 'scale': .8}, 'cut')

motion = {'conventions': {
  'time_unit': 'seconds', 'easing_defs': {'eio': 'smoothstep x²(3−2x)', 'eoc': 'ease-out cubic 1−(1−x)³', 'eob(k)': 'ease-out-back, overshoot k',
  'spring': 'eob(k=1.7) ≈6% overshoot', 'linear': 'clamp((t−in)/dur)'},
  'alpha_rule': 'unless stated, alpha = clamp(progress × 4..5) – i.e. fully opaque in the first 20–25 % of the tween',
  'pos': 'sprite centre in px', 'jolt': 'whole-frame shake jolt(t0, amp px, dur)'},
 'plates': {
 '179': {'stage': 'terra', 'duration': 12.0, 'beats': [
   {'beat': 'A', 'range': [0, 3.2], 'codes': 'M535+I534', 'layers': [
     L('MARKETING TEAM BUILT card', .30, .25, 'spring(scale) + eoc(y)', {'pos': [960, 560], 'scale': .7, 'alpha': 0}, {'pos': [960, 500], 'scale': 1}),
     L('team card → header', 3.10, .40, 'eio', {'pos': [960, 500], 'scale': 1}, {'pos': [960, 210], 'scale': .62}, 'fade 6.2s +0.4 eio')]},
   {'beat': 'B', 'range': [3.2, 6.4], 'codes': 'M536+I535', 'layers': [
     L('bot card ×4 (stagger 0.25)', 3.50, .25, 'eob(2) scale + eoc y', {'pos': '[430|750|1070|1390, 600]', 'scale': .5}, {'pos': '[x, 560]', 'scale': 1}),
     L('bots stack', 5.00, .45, 'eio', {'pos': '[x_i, 560]'}, {'pos': '[960+14i, 560−14i]'}, 'fade 6.2s +0.4'),
     L('BEFORE plaque (coral)', 3.40, .22, 'eob(1.6)', {'pos': [960, 790], 'scale': 1.3}, {'scale': 1}, 'fade 6.2s +0.4'),
     L('EACH BOT kicker', 4.00, .22, 'linear alpha', {'pos': [960, 880], 'alpha': 0}, {'alpha': 1}, 'fade 6.2s +0.4'),
     L('coral strike line 14px', 5.60, .25, 'eio (draw-on)', {'p0': [780, 680]}, {'p1': [1180, 440]}, 'fade 6.2s +0.4')]},
   {'beat': 'C', 'range': [6.4, 12.0], 'codes': 'M537+I536+E181', 'layers': [
     L('MANAGER plaque (coral)', 6.60, .25, 'eob(1.6)', {'pos': [960, 330], 'scale': 1.3}, {'scale': 1}),
     L('PLANS kicker', 6.90, .20, 'linear alpha', {'pos': [960, 410], 'alpha': 0}, {'alpha': 1}),
     L('dashed branches ×2', 7.10, .40, 'eio (draw-on)', {'path': '(960,450)→(960,500)→(600|1320,500)'}, {'end': '(600|1320,560)'}),
     L('TEAM YOU NEED label', 7.50, .22, 'linear alpha', {'pos': [600, 590]}, {}),
     L('filled slot ×3 (stagger 0.15)', 7.80, .20, 'eob(2)', {'pos': '[600, 690+100k]', 'scale': .5}, {'scale': 1}),
     L('STILL MUST BE HIRED label (coral HIRED)', 9.30, .22, 'eob(1.6)', {'pos': [1320, 590], 'scale': 1.25}, {'scale': 1}),
     L('dashed "+" slot ×2 (stagger 0.2)', 9.60, .20, 'eob(2)', {'pos': '[1320, 690+100k]', 'scale': .5}, {'scale': 1}),
     PEEK('GROUP CHAT', 11.0)]}]},
 '180': {'stage': 'emer', 'duration': 7.5, 'beats': [
   {'beat': 'A', 'range': [0, 1.8], 'codes': 'M538+I537', 'layers': [TABIN('GROUP CHAT', [720, 560]),
     L('GROUP CHAT dark panel 900×660', .05, .30, 'spring(scale) + eoc(y) driven by tab e', {'pos': [720, 620], 'scale': .6, 'alpha': 0}, {'pos': [720, 560], 'scale': 1})]},
   {'beat': 'B', 'range': [1.8, 3.8], 'codes': 'M539+I538', 'layers': [
     L('ONE PLACE tray', 1.60, .25, 'linear alpha', {'pos': [720, 430], 'alpha': 0}, {'alpha': 1}),
     L('ASSIGN WORK label', 1.80, .22, 'spring', {'pos': [1500, 330], 'scale': 1.2}, {'scale': 1}),
     L('task chip ×3 (stagger 0.2)', 2.00, .30, 'eoc x + arc −120·sin(πu)', {'pos': [1800, 444]}, {'pos': '[490+230k, 444]'})]},
   {'beat': 'C', 'range': [3.8, 7.5], 'codes': 'M540+I539+E182', 'layers': [
     L('progress card ×2 (stagger 0.4)', 4.00, .25, 'eob(2.2) y', {'pos': '[720, 600+130k]'}, {'pos': '[720, 630+130k]'}),
     L('PROGRESS REPORTS label', 4.10, .25, 'spring', {'pos': [1500, 560], 'scale': 1.2}, {'scale': 1}),
     L('SAME CHAT label (coral)', 5.00, .22, 'eob(1.6)', {'pos': [1500, 700], 'scale': 1.3}, {'scale': 1}),
     PEEK('FIVE EMPLOYEES', 6.4)]}]},
 '181': {'stage': 'cobalt', 'duration': 7.5, 'beats': [
   {'beat': 'A', 'range': [0, 2.2], 'codes': 'M541+I540', 'layers': [TABIN('FIVE EMPLOYEES', [960, 140]),
     L('BUILD FIVE EMPLOYEES header', .05, .30, 'eob(1.4)', {'pos': [960, 140], 'scale': .5}, {'scale': 1}),
     L('disc 01–05 (stagger 0.18)', .40, .20, 'eob(2.2)', {'pos': '[560+200k, 540]', 'scale': .4}, {'scale': 1})]},
   {'beat': 'B', 'range': [2.2, 4.8], 'codes': 'M542+I541', 'layers': [
     L('discs row → ring', 2.20, .45, 'eio', {'pos': 'row'}, {'pos': 'ellipse centre (960,540) rx 340 ry 279, angle −90+72k'}),
     L('ring arc + dashed spokes', 2.60, .40, 'eio (draw-on)', {'arc': -90}, {'arc': 270}),
     L('SHARED MEMORY hub + GROUP', 2.50, .25, 'spring', {'pos': [960, 540], 'scale': .6}, {'scale': 1})]},
   {'beat': 'C', 'range': [4.8, 7.5], 'codes': 'M543+I542+E183', 'layers': [
     L('EVERYONE SEES PROGRESS banner', 4.80, .25, 'eob(1.6)', {'pos': [960, 975], 'scale': 1.25}, {'scale': 1}),
     L('progress bar under each disc', 5.00, .80, 'eio', {'fill': 0}, {'fill': '0.5+0.1k'}),
     PEEK('RESEARCH → CONTENT', 6.4)]}]},
 '182': {'stage': 'violet', 'duration': 8.0, 'beats': [
   {'beat': 'A', 'range': [0, 2.2], 'codes': 'M544+I543', 'layers': [TABIN('RESEARCH → CONTENT', [500, 300]),
     L('RESEARCH plaque (coral)', .05, .30, 'eob(1.4)', {'pos': [500, 300], 'scale': .5}, {'scale': 1}),
     L('finding card ×3 (stagger 0.15)', 1.40, .25, 'eob(2)', {'pos': '[500, 520|650|780]', 'scale': .5}, {'scale': 1}),
     L('FINDINGS tag', 1.50, .20, 'linear alpha', {'pos': [360, 440]}, {}, 'fades during relabel 3.2s')]},
   {'beat': 'B', 'range': [2.2, 4.4], 'codes': 'M545+I544', 'layers': [
     L('card flip FINDINGS→POSTS (per card +0.1)', 3.20, .35, 'vertical squash |1−2u| swap at 0.5', {'card': 'finding'}, {'card': 'post (image block + stubs)'}),
     L('POSTS tag (coral)', 3.38, .18, 'eob(1.6)', {'pos': [340, 440], 'scale': 1.3}, {'scale': 1})]},
   {'beat': 'C', 'range': [4.4, 8.0], 'codes': 'M546+I545+E184', 'layers': [
     L('dashed hand-off arrow', 4.60, .40, 'eio (draw-on)', {'p0': [700, 300]}, {'p1': [1220, 300], 'head': 'appears at 95%'}),
     L('HAND OFF kicker', 4.80, .20, 'linear alpha', {'pos': [960, 244]}, {}),
     L('CONTENT plaque (coral)', 4.90, .25, 'eob(1.6)', {'pos': [1420, 300], 'scale': 1.3}, {'scale': 1}),
     L('post cards travel (stagger 0.12)', 5.00, .50, 'eio + arc −60·sin(πu)', {'pos': '[500, 520|650|780]'}, {'pos': '[1420, 520|650|780]'}),
     PEEK('MANAGER ASSIGNS', 6.9)]}]},
 '183': {'stage': 'hotpink', 'duration': 7.5, 'beats': [
   {'beat': 'A', 'range': [0, 1.6], 'codes': 'M547+I546', 'layers': [TABIN('MANAGER ASSIGNS', [420, 230]),
     L('MANAGER ASSIGNS plaque', .05, .30, 'eob(1.4)', {'pos': [420, 230], 'scale': .5}, {'scale': 1}),
     L('lane tracks ×3', .50, .40, 'eio (draw-on)', {'x': 260}, {'x': 1060, 'y': [430, 530, 630]}),
     L('token ×3 dealt (stagger 0.12)', .80, .30, 'eoc', {'pos': [420, 230]}, {'pos': '[350, lane_y]'})]},
   {'beat': 'B', 'range': [1.6, 3.2], 'codes': 'M548+I547', 'layers': [
     L('STAFF EXECUTE plaque', 1.60, .22, 'eob(1.6)', {'pos': [420, 800], 'scale': 1.3}, {'scale': 1}),
     L('tokens run lanes (stagger 0.15)', 1.80, 1.20, 'eio', {'x': 350}, {'x': 970})]},
   {'beat': 'C', 'range': [3.2, 7.5], 'codes': 'M549+I548+E185', 'layers': [
     L('GROUP CHAT panel 640×620', 3.00, .25, 'spring', {'pos': [1480, 600], 'scale': .7}, {'pos': [1480, 540], 'scale': 1}),
     L('dashed sync lines ×3', 3.20, .40, 'eio (draw-on)', {'x': 1060}, {'x': 1150}),
     L('SYNCS tag (coral)', 3.30, .20, 'eob(1.6)', {'pos': [1710, 220], 'scale': 1.3}, {'scale': 1}),
     L('progress bars ×4 (stagger 0.15)', 3.60, .70, 'eio', {'fill': 0}, {'fill': [.9, .7, .8, .6]}),
     L('FULL TASK PROGRESS · WHOLE TEAM caption', 4.60, .25, 'spring', {'pos': [960, 975], 'scale': 1.2}, {'scale': 1}),
     PEEK('LEAD · ACCEPT · FIX', 6.4)]}]},
 '184': {'stage': 'navy', 'duration': 12.5, 'beats': [
   {'beat': 'A', 'range': [0, 3.2], 'codes': 'M550+I549', 'layers': [TABIN('LEAD · ACCEPT · FIX', [470, 520]),
     L('EVERY STATUS board 560×560', .05, .30, 'spring + eoc', {'pos': [470, 580], 'scale': .6}, {'pos': [470, 520], 'scale': 1}),
     L('LEAD kicker', .60, .20, 'linear alpha', {'pos': [470, 200]}, {})]},
   {'beat': 'B', 'range': [3.2, 7.0], 'codes': 'M551+I550', 'layers': [
     L('dashed board→gate', 3.40, .40, 'eio', {'p0': [760, 400]}, {'p1': [960, 400]}),
     L('MANAGER ACCEPT gate', 3.50, .25, 'eob(1.6)', {'pos': [1130, 400], 'scale': 1.3}, {'scale': 1}),
     L('dashed gate→YOU', 3.70, .40, 'eio', {'p0': [1300, 400]}, {'p1': [1480, 400]}),
     L('YOU card', 3.80, .25, 'eob(1.8)', {'pos': [1610, 400], 'scale': .7}, {'scale': 1}),
     L('BEFORE IT COMES TO YOU kicker', 4.10, .22, 'linear alpha', {'pos': [1430, 510]}, {}),
     L('token 1 → gate', 4.30, .60, 'eio', {'pos': [750, 320]}, {'pos': [1130, 320]}),
     L('green check', 4.95, .20, 'linear alpha', {'pos': [1330, 320]}, {}, 'hides as token leaves'),
     L('token 1 → YOU', 5.30, .60, 'eio', {'pos': [1130, 320], 'scale': 1}, {'pos': [1610, 400], 'scale': .6}, 'fades in last 30 %')]},
   {'beat': 'C', 'range': [7.0, 12.5], 'codes': 'M552+I551+E186', 'layers': [
     L('token 2 → gate', 7.20, .60, 'eio', {'pos': [750, 320]}, {'pos': [1130, 320]}),
     L('FAILS REVIEW stamp (rot −6°)', 7.90, .22, 'eob(1.5)', {'pos': [1130, 225], 'scale': 1.4}, {'scale': 1}, jolt=[8.05, 3, .12]),
     L('coral dashed send-back', 8.60, .40, 'eio (draw-on)', {'p0': [1130, 450]}, {'p1': [1130, 730]}),
     L('token 2 drops', 8.80, .70, 'eio', {'pos': [1130, 320]}, {'pos': [1130, 690]}),
     L('SEND BACK kicker', 8.80, .20, 'linear alpha', {'pos': [1250, 620]}, {}),
     L('RIGHT EMPLOYEE card', 9.10, .25, 'eob(1.8)', {'pos': [1130, 800], 'scale': .7}, {'scale': 1}),
     L('FIX plaque (coral, 72px)', 10.00, .22, 'eob(1.5)', {'pos': [1500, 800], 'scale': 1.4}, {'scale': 1}, jolt=[10.18, 4, .16]),
     L('E186 soft-strong freeze', 10.22, 2.28, 'hold', {}, {}, 'end')]}]}}}

for name, obj in (('palette', palette), ('typography', typography), ('design', design), ('motion', motion)):
    json.dump(obj, open(os.path.join(OUT, name + '.json'), 'w'), indent=2, ensure_ascii=False)
print('specs written')
