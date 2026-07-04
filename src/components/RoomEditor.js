import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/rooms';
import { ROOMS } from '../constants/rooms';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';

const ROOM_ICONS = [
  '🍳', '🛁', '🛏️', '🛋️', '🍽️', '💼', '🚿', '🚪', '🪟', '🪑',
  '🛒', '🏠', '🏡', '🏢', '🏪', '🏬', '🏭', '🏮', '🏯', '🏰',
  '🏳️', '🏴', '🏵️', '🏶', '🏷️', '🏸', '🏹', '🏺', '🏻', '🏼',
  '🏽', '🏾', '🏿', '🐀', '🐁', '🐂', '🐃', '🐄', '🐅', '🐆',
  '🐇', '🐈', '🐉', '🐊', '🐋', '🐌', '🐍', '🐎', '🐏', '🐐',
  '🐑', '🐒', '🐓', '🐔', '🐕', '🐖', '🐗', '🐘', '🐙', '🐚',
  '🐛', '🐜', '🐝', '🐞', '🐟', '🐠', '🐡', '🐢', '🐣', '🐤',
  '🐥', '🐦', '🐧', '🐨', '🐩', '🐪', '🐫', '🐬', '🐭', '🐮',
  '🐯', '🐰', '🐱', '🐲', '🐳', '🐴', '🐵', '🐶', '🐷', '🐸',
  '🐹', '🐺', '🐻', '🐼', '🐽', '🐾', '🐿️', '👀', '👁️', '👂',
  '👃', '👄', '👅', '👆', '👇', '👈', '👉', '👊', '👋', '👌',
  '👍', '👎', '👏', '👐', '👑', '👒', '👓', '👔', '👕', '👖',
  '👗', '👘', '👙', '👚', '👛', '👜', '👝', '👞', '👟', '👠',
  '👡', '👢', '👣', '👤', '👥', '👦', '👧', '👨', '👩', '👪',
  '👫', '👬', '👭', '👮', '👯', '👰', '👱', '👲', '👳', '👴',
  '👵', '👶', '👷', '👸', '👹', '👺', '👻', '👼', '👽', '👾',
  '👿', '💀', '💁', '💂', '💃', '💄', '💅', '💆', '💇', '💈',
  '💉', '💊', '💋', '💌', '💍', '💎', '💏', '💐', '💑', '💒',
  '💓', '💔', '💕', '💖', '💗', '💘', '💙', '💚', '💛', '💜',
  '💝', '💞', '💟', '💠', '💡', '💢', '💣', '💤', '💥', '💦',
  '💧', '💨', '💩', '💪', '💫', '💬', '💭', '💮', '💯', '💰',
  '💱', '💲', '💳', '💴', '💵', '💶', '💷', '💸', '💹', '💺',
  '💻', '💼', '💽', '💾', '💿', '📀', '📁', '📂', '📃', '📄',
  '📅', '📆', '📇', '📈', '📉', '📊', '📋', '📌', '📍', '📎',
  '📏', '📐', '📑', '📒', '📓', '📔', '📕', '📖', '📗', '📘',
  '📙', '📚', '📛', '📜', '📝', '📞', '📟', '📠', '📡', '📢',
  '📣', '📤', '📥', '📦', '📧', '📨', '📩', '📪', '📫', '📬',
  '📭', '📮', '📯', '📰', '📱', '📲', '📳', '📴', '📵', '📶',
  '📷', '📸', '📹', '📺', '📻', '📼', '📽️', '📾', '📿', '🔀',
  '🔁', '🔂', '🔃', '🔄', '🔅', '🔆', '🔇', '🔈', '🔉', '🔊',
  '🔋', '🔌', '🔍', '🔎', '🔏', '🔐', '🔑', '🔒', '🔓', '🔔',
  '🔕', '🔖', '🔗', '🔘', '🔙', '🔚', '🔛', '🔜', '🔝', '🔞',
  '🔟', '🔠', '🔡', '🔢', '🔣', '🔤', '🔥', '🔦', '🔧', '🔨',
  '🔩', '🔪', '🔫', '🔬', '🔭', '🔮', '🔯', '🔰', '🔱', '🔲',
  '🔳', '🔴', '🔵', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '🔼',
  '🔽', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘',
  '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢',
  '🕣', '🕤', '🕥', '🕦', '🕧', '🕰️', '🕱', '🕲', '🕳️', '🕴️',
  '🕵️', '🕶️', '🕷️', '🕸️', '🕹️', '🕺', '🖀', '🖁', '🖂', '🖃',
  '🖄', '🖅', '🖆', '🖇️', '🖈', '🖉', '🖊️', '🖋️', '🖌️', '🖍️',
  '🖎', '🖏', '🖐️', '🖑', '🖒', '🖓', '🖔', '🖕', '🖖', '🖗',
  '🖘', '🖙', '🖚', '🖛', '🖜', '🖝', '🖞', '🖟', '🖠', '🖡',
  '🖢', '🖣', '🖤', '🖥️', '🖦', '🖧', '🖨️', '🖩', '🖪', '🖫',
  '🖬', '🖭', '🖮', '🖯', '🖰', '🖱️', '🖲️', '🖳', '🖴', '🖵',
  '🖶', '🖷', '🖸', '🖹', '🖺', '🖻', '🖼️', '🖽', '🖾', '🖿',
  '🗀', '🗁', '🗂️', '🗃️', '🗄️', '🗅', '🗆', '🗇', '🗈', '🗉',
  '🗊', '🗋', '🗌', '🗍', '🗎', '🗏', '🗐', '🗑️', '🗒️', '🗓️',
  '🗔', '🗕', '🗖', '🗗', '🗘', '🗙', '🗚', '🗛', '🗜️', '🗝️',
  '🗞️', '🗟', '🗠', '🗡️', '🗢', '🗣️', '🗤', '🗥', '🗦', '🗧',
  '🗨️', '🗩', '🗪', '🗫', '🗬', '🗭', '🗮', '🗯️', '🗰', '🗱',
  '🗲', '🗳️', '🗴', '🗵', '🗶', '🗷', '🗸', '🗹', '🗺️', '🗻',
  '🗼', '🗽', '🗾', '🗿', '😀', '😁', '😂', '😃', '😄', '😅',
  '😆', '😇', '😈', '😉', '😊', '😋', '😌', '😍', '😎', '😏',
  '😐', '😑', '😒', '😓', '😔', '😕', '😖', '😗', '😘', '😙',
  '😚', '😛', '😜', '😝', '😞', '😟', '😠', '😡', '😢', '😣',
  '😤', '😥', '😦', '😧', '😨', '😩', '😪', '😫', '😬', '😭',
  '😮', '😯', '😰', '😱', '😲', '😳', '😴', '😵', '😶', '😷',
  '😸', '😹', '😺', '😻', '😼', '😽', '😾', '😿', '🙀', '🙁',
  '🙂', '🙃', '🙄', '🙅', '🙆', '🙇', '🙈', '🙉', '🙊', '🙋',
  '🙌', '🙍', '🙎', '🙏', '🙐', '🙑', '🙒', '🙓', '🙔', '🙕',
  '🙖', '🙗', '🙘', '🙙', '🙚', '🙛', '🙜', '🙝', '🙞', '🙟',
  '🙠', '🙡', '🙢', '🙣', '🙤', '🙥', '🙦', '🙧', '🙨', '🙩',
  '🙪', '🙫', '🙬', '🙭', '🙮', '🙯', '🙰', '🙱', '🙲', '🙳',
  '🙴', '🙵', '🙶', '🙷', '🙸', '🙹', '🙺', '🙻', '🙼', '🙽',
  '🙾', '🙿', '🚀', '🚁', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇',
  '🚈', '🚉', '🚊', '🚋', '🚌', '🚍', '🚎', '🚏', '🚐', '🚑',
  '🚒', '🚓', '🚔', '🚕', '🚖', '🚗', '🚘', '🚙', '🚚', '🚛',
  '🚜', '🚝', '🚞', '🚟', '🚠', '🚡', '🚢', '🚣', '🚤', '🚥',
  '🚦', '🚧', '🚨', '🚩', '🚪', '🚫', '🚬', '🚭', '🚮', '🚯',
  '🚰', '🚱', '🚲', '🚳', '🚴', '🚵', '🚶', '🚷', '🚸', '🚹',
  '🚺', '🚻', '🚼', '🚽', '🚾', '🚿', '🛀', '🛁', '🛂', '🛃',
  '🛄', '🛅', '🛆', '🛇', '🛈', '🛉', '🛊', '🛋️', '🛌', '🛍️',
  '🛎️', '🛏️', '🛐', '🛑', '🛒', '🛓', '🛔', '🛕', '🛖', '🛗',
  '🛘', '🛙', '🛚', '🛛', '🛜', '🛝', '🛞', '🛟', '🛠️', '🛡️',
  '🛢️', '🛣️', '🛤️', '🛥️', '🛦', '🛧', '🛨', '🛩️', '🛪', '🛫',
  '🛬', '🛭', '🛮', '🛯', '🛰️', '🛱️', '🛲️', '🛳️', '🛴', '🛵',
  '🛶', '🛷', '🛸', '🛹', '🛺', '🛻', '🛼', '🛽', '🛾', '🛿',
  '🜀', '🜁', '🜂', '🜃', '🜄', '🜅', '🜆', '🜇', '🜈', '🜉',
  '🜊', '🜋', '🜌', '🜍', '🜎', '🜏', '🜐', '🜑', '🜒', '🜓',
  '🜔', '🜕', '🜖', '🜗', '🜘', '🜙', '🜚', '🜛', '🜜', '🜝',
  '🜞', '🜟', '🜠', '🜡', '🜢', '🜣', '🜤', '🜥', '🜦', '🜧',
  '🜨', '🜩', '🜪', '🜫', '🜬', '🜭', '🜮', '🜯', '🜰', '🜱',
  '🜲', '🜳', '🜴', '🜵', '🜶', '🜷', '🜸', '🜹', '🜺', '🜻',
  '🜼', '🜽', '🜾', '🜿', '🝀', '🝁', '🝂', '🝃', '🝄', '🝅',
  '🝆', '🝇', '🝈', '🝉', '🝊', '🝋', '🝌', '🝍', '🝎', '🝏',
  '🝐', '🝑', '🝒', '🝓', '🝔', '🝕', '🝖', '🝗', '🝘', '🝙',
  '🝚', '🝛', '🝜', '🝝', '🝞', '🝟', '🝠', '🝡', '🝢', '🝣',
  '🝤', '🝥', '🝦', '🝧', '🝨', '🝩', '🝪', '🝫', '🝬', '🝭',
  '🝮', '🝯', '🝰', '🝱', '🝲', '🝳', '🝴', '🝵', '🝶', '🝷',
  '🝸', '🝹', '🝺', '🝻', '🝼', '🝽', '🝾', '🝿', '🞀', '🞁',
  '🞂', '🞃', '🞄', '🞅', '🞆', '🞇', '🞈', '🞉', '🞊', '🞋',
  '🞌', '🞍', '🞎', '🞏', '🞐', '🞑', '🞒', '🞓', '🞔', '🞕',
  '🞖', '🞗', '🞘', '🞙', '🞚', '🞛', '🞜', '🞝', '🞞', '🞟',
  '🞠', '🞡', '🞢', '🞣', '🞤', '🞥', '🞦', '🞧', '🞨', '🞩',
  '🞪', '🞫', '🞬', '🞭', '🞮', '🞯', '🞰', '🞱', '🞲', '🞳',
  '🞴', '🞵', '🞶', '🞷', '🞸', '🞹', '🞺', '🞻', '🞼', '🞽',
  '🞾', '🞿', '🟀', '🟁', '🟂', '🟃', '🟄', '🟅', '🟆', '🟇',
  '🟈', '🟉', '🟊', '🟋', '🟌', '🟍', '🟎', '🟏', '🟐', '🟑',
  '🟒', '🟓', '🟔', '🟕', '🟖', '🟗', '🟘', '🟙', '🟚', '🟛',
  '🟜', '🟝', '🟞', '🟟', '🟠', '🟡', '🟢', '🟣', '🟤', '🟥',
  '🟦', '🟧', '🟨', '🟩', '🟪', '🟫', '🟬', '🟭', '🟮', '🟯',
  '🟰', '🟱', '🟲', '🟳', '🟴', '🟵', '🟶', '🟷', '🟸', '🟹',
  '🟺', '🟻', '🟼', '🟽', '🟾', '🟿', '🠀', '🠁', '🠂', '🠃',
  '🠄', '🠅', '🠆', '🠇', '🠈', '🠉', '🠊', '🠋', '🠌', '🠍',
  '🠎', '🠏', '🠐', '🠑', '🠒', '🠓', '🠔', '🠕', '🠖', '🠗',
  '🠘', '🠙', '🠚', '🠛', '🠜', '🠝', '🠞', '🠟', '🠠', '🠡',
  '🠢', '🠣', '🠤', '🠥', '🠦', '🠧', '🠨', '🠩', '🠪', '🠫',
  '🠬', '🠭', '🠮', '🠯', '🠰', '🠱', '🠲', '🠳', '🠴', '🠵',
  '🠶', '🠷', '🠸', '🠹', '🠺', '🠻', '🠼', '🠽', '🠾', '🠿',
  '🡀', '🡁', '🡂', '🡃', '🡄', '🡅', '🡆', '🡇', '🡈', '🡉',
  '🡊', '🡋', '🡌', '🡍', '🡎', '🡏', '🡐', '🡑', '🡒', '🡓',
  '🡔', '🡕', '🡖', '🡗', '🡘', '🡙', '🡚', '🡛', '🡜', '🡝',
  '🡞', '🡟', '🡠', '🡡', '🡢', '🡣', '🡤', '🡥', '🡦', '🡧',
  '🡨', '🡩', '🡪', '🡫', '🡬', '🡭', '🡮', '🡯', '🡰', '🡱',
  '🡲', '🡳', '🡴', '🡵', '🡶', '🡷', '🡸', '🡹', '🡺', '🡻',
  '🡼', '🡽', '🡾', '🡿', '🢀', '🢁', '🢂', '🢃', '🢄', '🢅',
  '🢆', '🢇', '🢈', '🢉', '🢊', '🢋', '🢌', '🢍', '🢎', '🢏',
  '🢐', '🢑', '🢒', '🢓', '🢔', '🢕', '🢖', '🢗', '🢘', '🢙',
  '🢚', '🢛', '🢜', '🢝', '🢞', '🢟', '🢠', '🢡', '🢢', '🢣',
  '🢤', '🢥', '🢦', '🢧', '🢨', '🢩', '🢪', '🢫', '🢬', '🢭',
  '🢮', '🢯', '🢰', '🢱', '🢲', '🢳', '🢴', '🢵', '🢶', '🢷',
  '🢸', '🢹', '🢺', '🢻', '🢼', '🢽', '🢾', '🢿', '🣀', '🣁',
  '🣂', '🣃', '🣄', '🣅', '🣆', '🣇', '🣈', '🣉', '🣊', '🣋',
  '🣌', '🣍', '🣎', '🣏', '🣐', '🣑', '🣒', '🣓', '🣔', '🣕',
  '🣖', '🣗', '🣘', '🣙', '🣚', '🣛', '🣜', '🣝', '🣞', '🣟',
  '🣠', '🣡', '🣢', '🣣', '🣤', '🣥', '🣦', '🣧', '🣨', '🣩',
  '🣪', '🣫', '🣬', '🣭', '🣮', '🣯', '🣰', '🣱', '🣲', '🣳',
  '🣴', '🣵', '🣶', '🣷', '🣸', '🣹', '🣺', '🣻', '🣼', '🣽',
  '🣾', '🣿', '🤀', '🤁', '🤂', '🤃', '🤄', '🤅', '🤆', '🤇',
  '🤈', '🤉', '🤊', '🤋', '🤌', '🤍', '🤎', '🤏', '🤐', '🤑',
  '🤒', '🤓', '🤔', '🤕', '🤖', '🤗', '🤘', '🤙', '🤚', '🤛',
  '🤜', '🤝', '🤞', '🤟', '🤠', '🤡', '🤢', '🤣', '🤤', '🤥',
  '🤦', '🤧', '🤨', '🤩', '🤪', '🤫', '🤬', '🤭', '🤮', '🤯',
  '🤰', '🤱', '🤲', '🤳', '🤴', '🤵', '🤶', '🤷', '🤸', '🤹',
  '🤺', '🤻', '🤼', '🤽', '🤾', '🤿', '🥀', '🥁', '🥂', '🥃',
  '🥄', '🥅', '🥆', '🥇', '🥈', '🥉', '🥊', '🥋', '🥌', '🥍',
  '🥎', '🥏', '🥐', '🥑', '🥒', '🥓', '🥔', '🥕', '🥖', '🥗',
  '🥘', '🥙', '🥚', '🥛', '🥜', '🥝', '🥞', '🥟', '🥠', '🥡',
  '🥢', '🥣', '🥤', '🥥', '🥦', '🥧', '🥨', '🥩', '🥪', '🥫',
  '🥬', '🥭', '🥮', '🥯', '🥰', '🥱', '🥲', '🥳', '🥴', '🥵',
  '🥶', '🥷', '🥸', '🥹', '🥺', '🥻', '🥼', '🥽', '🥾', '🥿',
  '🦀', '🦁', '🦂', '🦃', '🦄', '🦅', '🦆', '🦇', '🦈', '🦉',
  '🦊', '🦋', '🦌', '🦍', '🦎', '🦏', '🦐', '🦑', '🦒', '🦓',
  '🦔', '🦕', '🦖', '🦗', '🦘', '🦙', '🦚', '🦛', '🦜', '🦝',
  '🦞', '🦟', '🦠', '🦡', '🦢', '🦣', '🦤', '🦥', '🦦', '🦧',
  '🦨', '🦩', '🦪', '🦫', '🦬', '🦭', '🦮', '🦯', '🦰', '🦱',
  '🦲', '🦳', '🦴', '🦵', '🦶', '🦷', '🦸', '🦹', '🦺', '🦻',
  '🦼', '🦽', '🦾', '🦿', '🧀', '🧁', '🧂', '🧃', '🧄', '🧅',
  '🧆', '🧇', '🧈', '🧉', '🧊', '🧋', '🧌', '🧍', '🧎', '🧏',
  '🧐', '🧑', '🧒', '🧓', '🧔', '🧕', '🧖', '🧗', '🧘', '🧙',
  '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '🧠', '🧡', '🧢', '🧣',
  '🧤', '🧥', '🧦', '🧧', '🧨', '🧩', '🧪', '🧫', '🧬', '🧭',
  '🧮', '🧯', '🧰', '🧱', '🧲', '🧳', '🧴', '🧵', '🧶', '🧷',
  '🧸', '🧹', '🧺', '🧻', '🧼', '🧽', '🧾', '🧿', '🩀', '🩁',
  '🩂', '🩃', '🩄', '🩅', '🩆', '🩇', '🩈', '🩉', '🩊', '🩋',
  '🩌', '🩍', '🩎', '🩏', '🩐', '🩑', '🩒', '🩓', '🩔', '🩕',
  '🩖', '🩗', '🩘', '🩙', '🩚', '🩛', '🩜', '🩝', '🩞', '🩟',
  '🩠', '🩡', '🩢', '🩣', '🩤', '🩥', '🩦', '🩧', '🩨', '🩩',
  '🩪', '🩫', '🩬', '🩭', '🩮', '🩯', '🩰', '🩱', '🩲', '🩳',
  '🩴', '🩵', '🩶', '🩷', '🩸', '🩹', '🩺', '🩻', '🩼', '🩽',
  '🩾', '🩿', '🪀', '🪁', '🪂', '🪃', '🪄', '🪅', '🪆', '🪇',
  '🪈', '🪉', '🪊', '🪋', '🪌', '🪍', '🪎', '🪏', '🪐', '🪑',
  '🪒', '🪓', '🪔', '🪕', '🪖', '🪗', '🪘', '🪙', '🪚', '🪛',
  '🪜', '🪝', '🪞', '🪟', '🪠', '🪡', '🪢', '🪣', '🪤', '🪥',
  '🪦', '🪧', '🪨', '🪩', '🪪', '🪫', '🪬', '🪭', '🪮', '🪯',
  '🪰', '🪱', '🪲', '🪳', '🪴', '🪵', '🪶', '🪷', '🪸', '🪹',
  '🪺', '🪻', '🪼', '🪽', '🪾', '🪿', '🫀', '🫁', '🫂', '🫃',
  '🫄', '🫅', '🫆', '🫇', '🫈', '🫉', '🫊', '🫋', '🫌', '🫍',
  '🫎', '🫏', '🫐', '🫑', '🫒', '🫓', '🫔', '🫕', '🫖', '🫗',
  '🫘', '🫙', '🫚', '🫛', '🫜', '🫝', '🫞', '🫟', '🫠', '🫡',
  '🫢', '🫣', '🫤', '🫥', '🫦', '🫧', '🫨', '🫩', '🫪', '🫫',
  '🫬', '🫭', '🫮', '🫯', '🫰', '🫱', '🫲', '🫳', '🫴', '🫵',
  '🫶', '🫷', '🫸', '🫹', '🫺', '🫻', '🫼', '🫽', '🫾', '🫿',
  '🬀', '🬁', '🬂', '🬃', '🬄', '🬅', '🬆', '🬇', '🬈', '🬉',
  '🬊', '🬋', '🬌', '🬍', '🬎', '🬏', '🬐', '🬑', '🬒', '🬓',
  '🬔', '🬕', '🬖', '🬗', '🬘', '🬙', '🬚', '🬛', '🬜', '🬝',
  '🬞', '🬟', '🬠', '🬡', '🬢', '🬣', '🬤', '🬥', '🬦', '🬧',
  '🬨', '🬩', '🬪', '🬫', '🬬', '🬭', '🬮', '🬯', '🬰', '🬱',
  '🬲', '🬳', '🬴', '🬵', '🬶', '🬷', '🬸', '🬹', '🬺', '🬻',
  '🬼', '🬽', '🬾', '🬿', '🭀', '🭁', '🭂', '🭃', '🭄', '🭅',
  '🭆', '🭇', '🭈', '🭉', '🭊', '🭋', '🭌', '🭍', '🭎', '🭏',
  '🭐', '🭑', '🭒', '🭓', '🭔', '🭕', '🭖', '🭗', '🭘', '🭙',
  '🭚', '🭛', '🭜', '🭝', '🭞', '🭟', '🭠', '🭡', '🭢', '🭣',
  '🭤', '🭥', '🭦', '🭧', '🭨', '🭩', '🭪', '🭫', '🭬', '🭭',
  '🭮', '🭯', '🭰', '🭱', '🭲', '🭳', '🭴', '🭵', '🭶', '🭷',
  '🭸', '🭹', '🭺', '🭻', '🭼', '🭽', '🭾', '🭿', '🮀', '🮁',
  '🮂', '🮃', '🮄', '🮅', '🮆', '🮇', '🮈', '🮉', '🮊', '🮋',
  '🮌', '🮍', '🮎', '🮏', '🮐', '🮑', '🮒', '🮓', '🮔', '🮕',
  '🮖', '🮗', '🮘', '🮙', '🮚', '🮛', '🮜', '🮝', '🮞', '🮟',
  '🮠', '🮡', '🮢', '🮣', '🮤', '🮥', '🮦', '🮧', '🮨', '🮩',
  '🮪', '🮫', '🮬', '🮭', '🮮', '🮯', '🮰', '🮱', '🮲', '🮳',
  '🮴', '🮵', '🮶', '🮷', '🮸', '🮹', '🮺', '🮻', '🮼', '🮽',
  '🮾', '🮿', '🯀', '🯁', '🯂', '🯃', '🯄', '🯅', '🯆', '🯇',
  '🯈', '🯉', '🯊', '🯋', '🯌', '🯍', '🯎', '🯏', '🯐', '🯑',
  '🯒', '🯓', '🯔', '🯕', '🯖', '🯗', '🯘', '🯙', '🯚', '🯛',
  '🯜', '🯝', '🯞', '🯟', '🯠', '🯡', '🯢', '🯣', '🯤', '🯥',
  '🯦', '🯧', '🯨', '🯩', '🯪', '🯫', '🯬', '🯭', '🯮', '🯯',
  '🯰', '🯱', '🯲', '🯳', '🯴', '🯵', '🯶', '🯷', '🯸', '🯹',
  '🯺', '🯻', '🯼', '🯽', '🯾', '🯿', '🰀', '🰁', '🰂', '🰃',
  '🰄', '🰅', '🰆', '🰇', '🰈', '🰉', '🰊', '🰋', '🰌', '🰍',
  '🰎', '🰏', '🰐', '1', '🰒', '🰓', '🰔', '5', '🰖', '🰗',
  '🰘', '🰙', '🰚', '🰛', '🰜', '🰝', '🰞', '🰟', '🰠', '🰡',
  '🰢', '🰣', '🰤', '🰥', '🰦', '🰧', '🰨', '🰩', '🰪', '🰫',
  '🰬', '🰭', '🰮', '🰯', '🰰', '🰱', '🰲', '🰳', '🰴', '🰵',
  '🰶', '🰷', '🰸', '🰹', '🰺', '🰻', '🰼', '🰽', '🰾', '🰿',
  '🱀', '🱁', '🱂', '🱃', '🱄', '🱅', '🱆', '🱇', '🱈', '🱉',
  '🱊', '🱋', '🱌', '🱍', '🱎', '🱏', '🱐', '🱑', '🱒', '🱓',
  '🱔', '5', '🱖', '🱗', '🱘', '🱙', '🱚', '🱛', '🱜', '🱝',
  '🱞', '🱟', '🱠', '🱡', '🱢', '🱣', '🱤', '🱥', '🱦', '🱧',
  '🱨', '🱩', '🱪', '🱫', '🱬', '🱭', '🱮', '🱯', '🱰', '🱱',
  '🱲', '🱳', '🱴', '🱵', '🱶', '🱷', '🱸', '🱹', '🱺', '🱻',
  '🱼', '🱽', '🱾', '🱿', '🲀', '🲁', '🲂', '🲃', '🲄', '🲅',
  '🲆', '🲇', '🲈', '🲉', '🲊', '🲋', '🲌', '🲍', '🲎', '🲏',
  '🲐', '🲑', '🲒', '🲓', '🲔', '🲕', '🲖', '🲗', '🲘', '🲙',
  '🲚', '🲛', '🲜', '🲝', '🲞', '🲟', '🲠', '🲡', '🲢', '🲣',
  '🲤', '🲥', '🲦', '🲧', '🲨', '🲩', '🲪', '🲫', '🲬', '🲭',
  '🲮', '🲯', '🲰', '🲱', '🲲', '🲳', '🲴', '🲵', '🲶', '🲷',
  '🲸', '🲹', '🲺', '🲻', '🲼', '🲽', '🲾', '🲿', '🳀', '🳁',
  '🳂', '🳃', '🳄', '🳅', '🳆', '🳇', '🳈', '🳉', '🳊', '🳋',
  '🳌', '🳍', '🳎', '🳏', '🳐', '🳑', '🳒', '🳓', '🳔', '🳕',
  '🳖', '🳗', '🳘', '🳙', '🳚', '🳛', '🳜', '🳝', '🳞', '🳟',
  '🳠', '🳡', '🳢', '🳣', '🳤', '🳥', '🳦', '🳧', '🳨', '🳩',
  '🳪', '🳫', '🳬', '🳭', '🳮', '🳯', '🳰', '🳱', '🳲', '🳳',
  '🳴', '🳵', '🳶', '🳷', '🳸', '🳹', '🳺', '🳻', '🳼', '🳽',
  '🳾', '🳿', '🴀', '🴁', '🴂', '🴃', '🴄', '🴅', '🴆', '🴇',
  '🴈', '🴉', '🴊', '🴋', '🴌', '🴍', '🴎', '🴏', '🴐', '🴑',
  '🴒', '3', '🴔', '5', '🴖', '🴗', '8', '9', '🴚', '🴛',
  '🴜', '🴝', '🴞', '🴟', '🴠', '🴡', '🴢', '🴣', '🴤', '🴥',
  '🴦', '🴧', '🴨', '🴩', '🴪', '🴫', '🴬', '🴭', '🴮', '🴯',
  '🴰', '🴱', '🴲', '🴳', '🴴', '🴵', '🴶', '🴷', '🴸', '🴹',
  '🴺', '🴻', '🴼', '🴽', '🴾', '🴿', '🵀', '🵁', '🵂', '🵃',
  '🵄', '🵅', '🵆', '🵇', '🵈', '🵉', '🵊', '🵋', '🵌', '🵍',
  '🵎', '🵏', '🵐', '🵑', '🵒', '🵓', '🵔', '🵕', '🵖', '🵗',
  '🵘', '🵙', '🵚', '🵛', '🵜', '🵝', '🵞', '🵟', '🵠', '🵡',
  '🵢', '🵣', '🵤', '🵥', '🵦', '🵧', '🵨', '🵩', '🵪', '🵫',
  '🵬', '🵭', '🵮', '🵯', '🵰', '🵱', '🵲', '🵳', '🵴', '🵵',
  '🵶', '🵷', '🵸', '🵹', '🵺', '🵻', '🵼', '🵽', '🵾', '🵿',
  '🶀', '🶁', '🶂', '🶃', '🶄', '🶅', '🶆', '🶇', '🶈', '🶉',
  '🶊', '🶋', '🶌', '🶍', '🶎', '🶏', '🶐', '🶑', '🶒', '🶓',
  '🶔', '5', '🶖', '🶗', '🶘', '🶙', '🶚', '🶛', '🶜', '🶝',
  '🶞', '🶟', '🶠', '🶡', '🶢', '🶣', '🶤', '🶥', '🶦', '🶧',
  '🶨', '🶩', '🶪', '🶫', '🶬', '🶭', '🶮', '🶯', '🶰', '🶱',
  '🶲', '🶳', '🶴', '🶵', '🶶', '🶷', '🶸', '🶹', '🶺', '🶻',
  '🶼', '🶽', '🶾', '🶿', '🷀', '🷁', '🷂', '🷃', '🷄', '🷅',
  '🷆', '🷇', '🷈', '🷉', '🷊', '🷋', '🷌', '🷍', '🷎', '🷏',
  '🷐', '🷑', '🷒', '🷓', '🷔', '🷕', '🷖', '🷗', '🷘', '🷙',
  '🷚', '🷛', '🷜', '🷝', '🷞', '🷟', '🷠', '🷡', '🷢', '🷣',
  '🷤', '🷥', '🷦', '🷧', '🷨', '🷩', '🷪', '🷫', '🷬', '🷭',
  '🷮', '🷯', '🷰', '🷱', '🷲', '🷳', '🷴', '🷵', '🷶', '🷷',
  '🷸', '🷹', '🷺', '🷻', '🷼', '🷽', '🷾', '🷿', '🸀', '🸁',
  '🸂', '🸃', '🸄', '🸅', '🸆', '🸇', '🸈', '🸉', '🸊', '🸋',
  '🸌', '🸍', '🸎', '🸏', '🸐', '🸑', '🸒', '🸓', '🸔', '🸕',
  '🸖', '🸗', '🸘', '🸙', '🸚', '🸛', '🸜', '🸝', '🸞', '🸟',
  '🸠', '🸡', '🸢', '🸣', '🸤', '🸥', '🸦', '🸧', '🸨', '🸩',
  '🸪', '🸫', '🸬', '🸭', '🸮', '🸯', '🸰', '🸱', '🸲', '🸳',
  '🸴', '🸵', '🸶', '🸷', '🸸', '🸹', '🸺', '🸻', '🸼', '🸽',
  '🸾', '🸿', '🹀', '🹁', '🹂', '🹃', '🹄', '🹅', '🹆', '🹇',
  '🹈', '🹉', '🹊', '🹋', '🹌', '🹍', '🹎', '🹏', '🹐', '🹑',
  '🹒', '🹓', '🹔', '🹕', '🹖', '🹗', '🹘', '🹙', '🹚', '🹛',
  '🹜', '🹝', '🹞', '🹟', '🹠', '🹡', '🹢', '🹣', '🹤', '🹥',
  '🹦', '🹧', '🹨', '🹩', '🹪', '🹫', '🹬', '🹭', '🹮', '🹯',
  '🹰', '🹱', '🹲', '🹳', '🹴', '🹵', '🹶', '🹷', '🹸', '🹹',
  '🹺', '🹻', '🹼', '🹽', '🹾', '🹿', '🺀', '🺁', '🺂', '🺃',
  '🺄', '🺅', '🺆', '🺇', '🺈', '🺉', '🺊', '🺋', '🺌', '🺍',
  '🺎', '🺏', '🺐', '🺑', '🺒', '🺓', '🺔', '🺕', '🺖', '🺗',
  '🺘', '🺙', '🺚', '🺛', '🺜', '🺝', '🺞', '🺟', '🺠', '🺡',
  '🺢', '🺣', '🺤', '🺥', '🺦', '🺧', '🺨', '🺩', '🺪', '🺫',
  '🺬', '🺭', '🺮', '🺯', '🺰', '🺱', '🺲', '🺳', '🺴', '🺵',
  '🺶', '🺷', '🺸', '🺹', '🺺', '🺻', '🺼', '🺽', '🺾', '🺿',
  '🻀', '🻁', '🻂', '🻃', '🻄', '🻅', '🻆', '🻇', '🻈', '🻉',
  '🻊', '🻋', '🻌', '🻍', '🻎', '🻏', '🻐', '1', '🻒', '3',
  '🻔', '5', '6', '7', '8', '9', '🻚', '🻛', '🻜', '🻝',
  '🻞', '🻟', '🻠', '🻡', '🻢', '🻣', '🻤', '🻥', '🻦', '🻧',
  '🻨', '🻩', '🻪', '🻫', '🻬', '🻭', '🻮', '🻯', '🻰', '🻱',
  '🻲', '🻳', '🻴', '🻵', '🻶', '🻷', '🻸', '🻹', '🻺', '🻻',
  '🻼', '🻽', '🻾', '🻿', '🼀', '🼁', '🼂', '🼃', '🼄', '🼅',
  '🼆', '🼇', '🼈', '🼉', '🼊', '🼋', '🼌', '🼍', '🼎', '🼏',
  '🼐', '🼑', '🼒', '🼓', '🼔', '🼕', '🼖', '🼗', '🼘', '🼙',
  '🼚', '🼛', '🼜', '🼝', '🼞', '🼟', '🼠', '🼡', '🼢', '🼣',
  '🼤', '🼥', '🼦', '🼧', '🼨', '🼩', '🼪', '🼫', '🼬', '🼭',
  '🼮', '🼯', '🼰', '🼱', '🼲', '🼳', '🼴', '🼵', '🼶', '🼷',
  '🼸', '🼹', '🼺', '🼻', '🼼', '🼽', '🼾', '🼿', '🽀', '🽁',
  '🽂', '🽃', '🽄', '🽅', '🽆', '🽇', '🽈', '🽉', '🽊', '🽋',
  '🽌', '🽍', '🽎', '🽏', '🽐', '🽑', '🽒', '🽓', '🽔', '🽕',
  '🽖', '🽗', '🽘', '🽙', '🽚', '🽛', '🽜', '🽝', '🽞', '🽟',
  '🽠', '🽡', '🽢', '🽣', '🽤', '🽥', '🽦', '🽧', '🽨', '🽩',
  '🽪', '🽫', '🽬', '🽭', '🽮', '🽯', '🽰', '🽱', '🽲', '🽳',
  '🽴', '🽵', '🽶', '🽷', '🽸', '🽹', '🽺', '🽻', '🽼', '🽽',
  '🽾', '🽿', '🾀', '🾁', '🾂', '🾃', '🾄', '🾅', '🾆', '🾇',
  '🾈', '🾉', '🾊', '🾋', '🾌', '🾍', '🾎', '🾏', '🾐', '🾑',
  '🾒', '🾓', '🾔', '🾕', '🾖', '🾗', '🾘', '🾙', '🾚', '🾛',
  '🾜', '🾝', '🾞', '🾟', '🾠', '🾡', '🾢', '🾣', '🾤', '🾥',
  '🾦', '🾧', '🾨', '🾩', '🾪', '🾫', '🾬', '🾭', '🾮', '🾯',
  '🾰', '🾱', '🾲', '🾳', '🾴', '🾵', '🾶', '🾷', '🾸', '🾹',
  '🾺', '🾻', '🾼', '🾽', '🾾', '🾿', '🿀', '🿁', '🿂', '🿃',
  '🿄', '🿅', '🿆', '🿇', '🿈', '🿉', '🿊', '🿋', '🿌', '🿍',
  '🿎', '🿏', '🿐', '🿑', '🿒', '🿓', '🿔', '🿕', '🿖', '🿗',
  '🿘', '🿙', '🿚', '🿛', '🿜', '🿝', '🿞', '🿟', '🿠', '🿡',
  '🿢', '🿣', '🿤', '🿥', '🿦', '🿧', '🿨', '🿩', '🿪', '🿫',
  '🿬', '🿭', '🿮', '🿯', '🿰', '🿱', '🿲', '🿳', '🿴', '🿵',
  '🿶', '🿷', '🿸', '🿹', '🿺', '🿻', '🿼', '🿽', '🿾', '🿿'
];

export default function RoomEditor({ visible, onClose, onSave, initialRooms = null, mode = 'customize', editRoom = null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { sectionLanguage, cleaningServiceEnabled } = useSettings();
  const [rooms, setRooms] = useState([]);
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [allowDefaultDeletion, setAllowDefaultDeletion] = useState(false);
  const [markAsDefault, setMarkAsDefault] = useState(false);
  const nameInputRef = useRef(null);

  // 

  const isDefaultRoom = (room) => {
    // Check if it's an original default room OR marked as default
    return ROOMS.some(defaultRoom => defaultRoom.id === room.id) || room.isDefault === true;
  };

  // Initialize rooms only when component first becomes visible
  useEffect(() => {
    if (visible && rooms.length === 0) {
      // 
      const initialData = initialRooms || ROOMS;
      setRooms([...initialData]);
    }
  }, [visible, initialRooms]);

  // Handle mode changes
  useEffect(() => {
    if (visible) {
      // 
      
      if (mode === 'add') {
        // Automatically add a new room and enter edit mode
        setTimeout(() => {
          handleAddRoom();
        }, 100);
      } else if (mode === 'edit' && editRoom) {
        // Enter edit mode for the specified room
        setTimeout(() => {
          setEditingRoom(editRoom.id);
          setRoomName(editRoom.name);
          setSelectedIcon(editRoom.icon);
          setMarkAsDefault(isDefaultRoom(editRoom));
        }, 100);
      } else {
        // Customize mode - show room list
        setEditingRoom(null);
        setRoomName('');
        setSelectedIcon('');
        setMarkAsDefault(false);
      }
    }
  }, [visible, mode, editRoom]);

  // Cleanup when component is closed
  useEffect(() => {
    if (!visible) {
      setRooms([]);
      setEditingRoom(null);
    setRoomName('');
    setSelectedIcon('');
    setIsEditingName(false);
    setShowNameModal(false);
    setAllowDefaultDeletion(false);
    setMarkAsDefault(false);
    }
  }, [visible]);

  const handleAddRoom = () => {
    // Use functional setState so we always read the LATEST rooms list.
    // Previously this closed over `rooms` from the render where the
    // setTimeout in the mode-handler effect was scheduled — that
    // render's `rooms` was still the empty initial state, so
    // [...rooms, newRoom] = [newRoom] and the save wiped every
    // existing folder. The functional updater fixes that race by
    // computing the new list against whatever's in state right now.
    const newRoom = {
      id: `room_${Date.now()}`,
      name: '',
      icon: '🏠',
      isDefault: markAsDefault,
    };
    setRooms((prev) => {
      if (prev.length >= 10) {
        Alert.alert(t('roomEditor.limitReached'), t('roomEditor.limitReachedMessage'));
        return prev;
      }
      const updatedRooms = [...prev, newRoom];
      onSave(updatedRooms);
      return updatedRooms;
    });

    setEditingRoom(newRoom.id);
    setRoomName('');
    setSelectedIcon('🏠');
    setIsEditingName(false);
  };

  const handleEditRoom = (room) => {
    // 
    setEditingRoom(room.id);
    setRoomName(room.name);
    setSelectedIcon(room.icon);
    setMarkAsDefault(isDefaultRoom(room));
    setIsEditingName(false); // Reset editing state
  };

  const handleSaveRoom = () => {
    //
    if (!roomName.trim()) {
      Alert.alert(t('common.error'), t('roomEditor.emptyNameError'));
      return;
    }

    const updatedRooms = rooms.map(room => 
      room.id === editingRoom 
        ? { ...room, name: roomName.trim(), icon: selectedIcon, isDefault: markAsDefault }
        : room
    );
    
    // 
    setRooms(updatedRooms);
    setEditingRoom(null);
    setRoomName('');
    setSelectedIcon('');
    setIsEditingName(false);
    setMarkAsDefault(false);

    // Save the changes and close the editor
    // 
    onSave(updatedRooms);
  };

  const handleDeleteRoom = (roomId) => {
    const roomToDelete = rooms.find(room => room.id === roomId);

    if (isDefaultRoom(roomToDelete) && !allowDefaultDeletion) {
      Alert.alert(
        t('roomEditor.protectedFolder'),
        t('roomEditor.protectedFolderMessage'),
        [{ text: t('common.ok') }]
      );
      return;
    }

    if (rooms.length <= 1) {
      Alert.alert(t('roomEditor.cannotDelete'), t('roomEditor.cannotDeleteMessage'));
      return;
    }

    Alert.alert(
      t('roomEditor.deleteFolder'),
      t('roomEditor.deleteFolderConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'), 
          style: 'destructive',
          onPress: () => {
            const updatedRooms = rooms.filter(room => room.id !== roomId);
            // 
            setRooms(updatedRooms);
            // Immediately save the changes
            // 
            onSave(updatedRooms);
          }
        }
      ]
    );
  };

  const handleSaveAll = () => {
    if (rooms.length === 0) {
      Alert.alert(t('common.error'), t('roomEditor.atLeastOneRoomError'));
      return;
    }

    //
    onSave(rooms);
    onClose();
  };

  const handleResetToDefault = () => {
    Alert.alert(
      t('roomEditor.resetToDefault'),
      t('roomEditor.resetConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('roomEditor.reset'), 
          style: 'destructive',
          onPress: () => {
            setRooms([...ROOMS]);
            setEditingRoom(null);
            setRoomName('');
            setSelectedIcon('');
            // Immediately save the changes
            onSave([...ROOMS]);
          }
        }
      ]
    );
  };


  const renderIconGrid = () => {
    // Use only a subset of icons for better performance
    const commonIcons = ROOM_ICONS.slice(0, 100); // First 100 icons
    
    return (
      <ScrollView style={styles.iconGrid} showsVerticalScrollIndicator={false}>
        <View style={styles.iconRow}>
          {commonIcons.map((icon, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.iconButton,
                selectedIcon === icon && styles.iconButtonSelected
              ]}
              onPress={() => {
                // 
                setSelectedIcon(icon);
              }}
            >
              <Text style={styles.iconText}>{icon}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  };

  const getDisplayRoomName = (room) => {
    if (cleaningServiceEnabled && room.id) {
      // Use translated room name when cleaning service is enabled
      return t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name });
    }
    return room.name;
  };

  const renderRoomEditor = () => {
    // 
    if (!editingRoom) return null;

    const currentRoom = rooms.find(r => r.id === editingRoom);

    return (
      <View style={styles.fullScreenEditor}>

        <ScrollView style={styles.editorContent}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('roomEditor.folderName')}</Text>
            <TouchableOpacity
              style={styles.roomNameButton}
              onPress={() => setShowNameModal(true)}
            >
              <Text style={styles.roomNameButtonText}>{roomName || t('roomEditor.folderName')}</Text>
              <Text style={styles.editHintText}>{t('roomEditor.tapToEdit')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('roomEditor.folderType')}</Text>
            <View style={styles.checkboxContainer}>
              <TouchableOpacity
                style={styles.checkbox}
                onPress={() => setMarkAsDefault(!markAsDefault)}
              >
                <View style={[styles.checkboxBox, markAsDefault && styles.checkboxBoxChecked]}>
                  {markAsDefault && <Text style={styles.checkboxCheck}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>{t('roomEditor.markAsDefault')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.checkboxDescription}>
              {t('roomEditor.defaultFolderDescription')}
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('roomEditor.selectIcon')}</Text>
            <View style={styles.currentIconContainer}>
              <Text style={styles.currentIcon}>{selectedIcon}</Text>
              <Text style={styles.currentIconLabel}>{t('roomEditor.currentIcon')}</Text>
            </View>
          </View>

          <View style={styles.iconGridContainer}>
            {renderIconGrid()}
          </View>
        </ScrollView>

        <View style={styles.editorFooter}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              //
              setEditingRoom(null);
              setRoomName('');
              setSelectedIcon('');
              setIsEditingName(false);
            }}
          >
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={() => {
              //
              handleSaveRoom();
            }}
          >
            <Text style={styles.saveButtonText}>{t('common.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={onClose}
          >
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {mode === 'add' ? t('roomEditor.addFolder') : mode === 'edit' ? t('roomEditor.editFolder') : t('roomEditor.editFolders')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView 
          style={styles.keyboardAvoidingView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <ScrollView style={styles.content}>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('roomEditor.yourFolders')}</Text>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={handleAddRoom}
                >
                  <Text style={styles.addButtonText}>{t('roomEditor.addButton')}</Text>
                </TouchableOpacity>
              </View>

              {/* Default Folder Deletion Checkbox */}
              <View style={styles.checkboxContainer}>
                <TouchableOpacity
                  style={styles.checkbox}
                  onPress={() => setAllowDefaultDeletion(!allowDefaultDeletion)}
                >
                  <View style={[styles.checkboxBox, allowDefaultDeletion && styles.checkboxBoxChecked]}>
                    {allowDefaultDeletion && <Text style={styles.checkboxCheck}>✓</Text>}
                  </View>
                  <Text style={styles.checkboxLabel}>{t('roomEditor.allowDeletion')}</Text>
                </TouchableOpacity>
              </View>

              {rooms.map((room, index) => (
                <View key={room.id} style={styles.roomItem}>
                  <View style={styles.roomInfo}>
                    <Text style={styles.roomIcon}>{room.icon}</Text>
                    <View style={styles.roomNameContainer}>
                          <Text style={styles.roomName}>{getDisplayRoomName(room)}</Text>
                      {isDefaultRoom(room) && (
                        <Text style={styles.defaultBadge} numberOfLines={1} adjustsFontSizeToFit>{t('roomEditor.defaultBadge')}</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.roomActions}>
                    <TouchableOpacity
                      style={styles.editButton}
                      onPress={() => handleEditRoom(room)}
                    >
                      <Text style={styles.editButtonText}>{t('common.edit')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.deleteButton,
                        isDefaultRoom(room) && !allowDefaultDeletion && styles.deleteButtonDisabled
                      ]}
                      onPress={() => handleDeleteRoom(room.id)}
                    >
                      <Text style={[
                        styles.deleteButtonText,
                        isDefaultRoom(room) && !allowDefaultDeletion && styles.deleteButtonTextDisabled
                      ]}>{t('common.delete')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <TouchableOpacity
                style={styles.resetButton}
                onPress={handleResetToDefault}
              >
                <Text style={styles.resetButtonText}>{t('roomEditor.resetToDefaultButton')}</Text>
              </TouchableOpacity>
            </View>

          </ScrollView>

          {renderRoomEditor()}
        </KeyboardAvoidingView>

        {/* Name Edit Modal */}
        <Modal visible={showNameModal} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={styles.nameModal}>
              <Text style={styles.modalTitle}>{t('roomEditor.editFolderNameTitle')}</Text>
              <TextInput
                ref={nameInputRef}
                style={styles.modalInput}
                value={roomName}
                onChangeText={setRoomName}
                placeholder={t('roomEditor.enterFolderName')}
                placeholderTextColor={theme.textMuted}
                maxLength={20}
                autoFocus={true}
                onFocus={() => {
                  setTimeout(() => {
                    if (nameInputRef.current) {
                      nameInputRef.current.setSelection(0, roomName.length);
                    }
                  }, 100);
                }}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setShowNameModal(false)}
                >
                  <Text style={styles.modalCancelText}>{t('common.done', { defaultValue: 'Done' })}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background
  },
  keyboardAvoidingView: {
    flex: 1
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
    backgroundColor: theme.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: theme.border
  },
  backButton: {
    width: 60
  },
  backButtonText: {
    color: COLORS.PRIMARY,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'left'
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 60,
  },
  saveAllButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10
  },
  saveAllButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600'
  },
  content: {
    flex: 1
  },
  section: {
    backgroundColor: theme.surfaceElevated,
    marginTop: 20,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary
  },
  addButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8
  },
  addButtonDisabled: {
    backgroundColor: theme.border,
    opacity: 0.6
  },
  addButtonText: {
    color: theme.textPrimary,
    fontWeight: '600',
    fontSize: 14
  },
  roomItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border
  },
  roomInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  roomIcon: {
    fontSize: 24,
    marginRight: 12
  },
  roomName: {
    fontSize: 16,
    color: theme.textPrimary,
    fontWeight: '500'
  },
  roomActions: {
    flexDirection: 'row'
  },
  editButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8,
    minWidth: 60
  },
  editButtonText: {
    color: theme.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1
  },
  deleteButton: {
    backgroundColor: '#FF6B6B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 60
  },
  deleteButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1
  },
  fullScreenEditor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surfaceElevated,
    zIndex: 1000
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: theme.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: theme.border
  },
  headerCancelButton: {
    backgroundColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8
  },
  headerCancelButtonText: {
    color: theme.textPrimary,
    fontSize: 16,
    fontWeight: '600'
  },
  headerSaveButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8
  },
  headerSaveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600'
  },
  editorContent: {
    flex: 1,
    padding: 20
  },
  editorFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: theme.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: theme.border
  },
  editorContainer: {
    backgroundColor: theme.surfaceElevated,
    marginTop: 20,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border
  },
  iconGridContainer: {
    marginTop: 20
  },
  editorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginBottom: 16
  },
  inputGroup: {
    marginBottom: 20
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textPrimary,
    marginBottom: 8
  },
  input: {
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    borderRadius: 8,
    color: theme.textPrimary,
    fontSize: 16
  },
  roomNameButton: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 16,
    backgroundColor: theme.surfaceElevated,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  roomNameButtonText: {
    fontSize: 16,
    color: theme.textPrimary,
    fontWeight: '500'
  },
  editHintText: {
    fontSize: 12,
    color: theme.textMuted,
    fontStyle: 'italic'
  },
  roomNameInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: theme.textPrimary,
    backgroundColor: theme.surfaceElevated
  },
  currentIconContainer: {
    alignItems: 'center',
    marginBottom: 12
  },
  currentIcon: {
    fontSize: 48,
    marginBottom: 4
  },
  currentIconLabel: {
    fontSize: 12,
    color: theme.textMuted
  },
  iconGrid: {
    height: 315, // 5 rows * (55px button + 8px margin) + 8px padding
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8
  },
  iconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8
  },
  iconButton: {
    width: 55,
    height: 55,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
    borderRadius: 12,
    backgroundColor: theme.surface
  },
  iconButtonSelected: {
    backgroundColor: COLORS.PRIMARY
  },
  iconText: {
    fontSize: 24
  },
  cancelButton: {
    flex: 1,
    backgroundColor: theme.border,
    paddingVertical: 12,
    borderRadius: 8,
    marginRight: 8
  },
  saveButton: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 12,
    borderRadius: 8,
    marginLeft: 8
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center'
  },
  cancelButtonText: {
    color: theme.textPrimary,
    fontWeight: '600',
    textAlign: 'center'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  nameModal: {
    backgroundColor: theme.surfaceElevated,
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 300
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
    textAlign: 'center',
    marginBottom: 16
  },
  modalInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: theme.textPrimary,
    backgroundColor: theme.surfaceElevated,
    marginBottom: 16
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'center'
  },
  modalCancelButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 80
  },
  modalCancelText: {
    color: 'white',
    fontWeight: '600',
    textAlign: 'center'
  },
  modalSaveButton: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 12,
    borderRadius: 8,
    marginLeft: 8
  },
  modalSaveText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center'
  },
  saveButton: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 12,
    borderRadius: 8,
    marginLeft: 8,
    alignItems: 'center'
  },
  saveButtonText: {
    color: theme.textPrimary,
    fontWeight: '600'
  },
  checkboxContainer: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    borderRadius: 4,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: COLORS.PRIMARY,
  },
  checkboxCheck: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: '500',
  },
  checkboxDescription: {
    color: theme.textSecondary,
    fontSize: 12,
    marginTop: 8,
    marginLeft: 4,
    fontStyle: 'italic'
  },
  roomNameContainer: {
    flex: 1,
  },
  defaultBadge: {
    backgroundColor: COLORS.PRIMARY,
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  deleteButtonTextDisabled: {
    color: theme.textMuted,
  },
  resetButton: {
    backgroundColor: '#FFE6E6',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center'
  },
  resetButtonText: {
    color: '#CC0000',
    fontSize: 16,
    fontWeight: '600'
  },
});
