export const ROOMS = [
  { id: 'bathroom', name: 'Bathroom', icon: '🛁',  image: require('../../assets/project_icons/bath.png') },
  { id: 'bedroom', name: 'Bedroom', icon: '🛏️', image: require('../../assets/project_icons/bed.png') },
  { id: 'kitchen', name: 'Kitchen', icon: '🍳', image: require('../../assets/project_icons/chef.png') },
  { id: 'living-room', name: 'Living Room', icon: '🛋️', image: require('../../assets/project_icons/sofa.png') },
  { id: 'dining-room', name: 'Dining Room', icon: '🍽️', image: require('../../assets/project_icons/chef.png') },
  { id: 'office', name: 'Office', icon: '💼', image: require('../../assets/project_icons/briefcase.png') }
];

export const PHOTO_MODES = {
  BEFORE: 'before',
  AFTER: 'after',
  COMBINED: 'mix'
};

export const TEMPLATE_TYPES = {
  STACK_PORTRAIT: 'stack-portrait',         // 9:16 portrait, stacked
  STACK_LANDSCAPE: 'stack-landscape',       // 16:9 landscape, stacked
  SIDE_BY_SIDE_LANDSCAPE: 'sidebyside-landscape', // 16:9 landscape, side-by-side
  SIDE_BY_SIDE_WIDE: 'sidebyside-wide',     // 2:1 extra wide, side-by-side
  SQUARE_STACK: 'square-stack',             // 1:1 square, stacked
  SQUARE_SIDE: 'square-sidebyside',         // 1:1 square, side-by-side
  BLOG_FORMAT: 'blog-16-9'                  // 16:9 blog format, side-by-side
};

export const TEMPLATE_CONFIGS = {
  [TEMPLATE_TYPES.STACK_PORTRAIT]: {
    name: 'Portrait (9:16)',
    width: 1080,
    height: 1920,
    layout: 'stack'
  },
  [TEMPLATE_TYPES.STACK_LANDSCAPE]: {
    name: 'Landscape (16:9)',
    width: 1920,
    height: 1080,
    layout: 'stack'
  },
  [TEMPLATE_TYPES.SIDE_BY_SIDE_LANDSCAPE]: {
    name: 'Side-by-Side (16:9)',
    width: 1920,
    height: 1080,
    layout: 'sidebyside'
  },
  [TEMPLATE_TYPES.SIDE_BY_SIDE_WIDE]: {
    name: 'Wide (2:1)',
    width: 2000,
    height: 1000,
    layout: 'sidebyside'
  },
  [TEMPLATE_TYPES.SQUARE_STACK]: {
    name: 'Square Stack (1:1)',
    width: 1080,
    height: 1080,
    layout: 'stack'
  },
  [TEMPLATE_TYPES.SQUARE_SIDE]: {
    name: 'Square Side (1:1)',
    width: 1080,
    height: 1080,
    layout: 'sidebyside'
  },
  [TEMPLATE_TYPES.BLOG_FORMAT]: {
    name: 'Blog (16:9)',
    width: 1920,
    height: 1080,
    layout: 'sidebyside'
  }
};

export const COLORS = {
  PRIMARY: '#F2C31B',
  BACKGROUND: '#f8fafc',
  TEXT: '#303030',
  BORDER: '#E1E1E1',
  GRAY: '#B3B3B3'
};

export const LABEL_POSITIONS = {
  'left-top': {
    top: 10,
    left: 10,
    horizontalAlign: 'flex-start',
    verticalAlign: 'flex-start',
    name: 'Left Top'
  },
  'left-middle': {
    top: '50%',
    left: 10,
    transform: [{ translateY: '-50%' }],
    horizontalAlign: 'flex-start',
    verticalAlign: 'center',
    name: 'Left Middle'
  },
  'left-bottom': {
    bottom: 10,
    left: 10,
    horizontalAlign: 'flex-start',
    verticalAlign: 'flex-end',
    name: 'Left Bottom'
  },
  'center-top': {
    top: 10,
    left: '50%',
    transform: [{ translateX: '-50%' }],
    horizontalAlign: 'center',
    verticalAlign: 'flex-start',
    name: 'Center Top'
  },
  'center-middle': {
    top: '50%',
    left: '50%',
    transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
    horizontalAlign: 'center',
    verticalAlign: 'center',
    name: 'Center Middle'
  },
  'center-bottom': {
    bottom: 10,
    left: '50%',
    transform: [{ translateX: '-50%' }],
    horizontalAlign: 'center',
    verticalAlign: 'flex-end',
    name: 'Center Bottom'
  },
  'right-top': {
    top: 10,
    right: 10,
    horizontalAlign: 'flex-end',
    verticalAlign: 'flex-start',
    name: 'Right Top'
  },
  'right-middle': {
    top: '50%',
    right: 10,
    transform: [{ translateY: '-50%' }],
    horizontalAlign: 'flex-end',
    verticalAlign: 'center',
    name: 'Right Middle'
  },
  'right-bottom': {
    bottom: 10,
    right: 10,
    horizontalAlign: 'flex-end',
    verticalAlign: 'flex-end',
    name: 'Right Bottom'
  }
};

export const DEFAULT_LABEL_POSITION = 'left-top';
export const DEFAULT_BEFORE_LABEL_POSITION = 'left-top';
export const DEFAULT_AFTER_LABEL_POSITION = 'right-top';
export const DEFAULT_WATERMARK_POSITION = 'right-bottom';

// Function to get label positions with custom margins
export const getLabelPositions = (marginVertical = 10, marginHorizontal = 10) => {
  return {
    'left-top': {
      top: marginVertical,
      left: marginHorizontal,
      horizontalAlign: 'flex-start',
      verticalAlign: 'flex-start',
      name: 'Left Top'
    },
    'left-middle': {
      top: '50%',
      left: marginHorizontal,
      transform: [{ translateY: '-50%' }],
      horizontalAlign: 'flex-start',
      verticalAlign: 'center',
      name: 'Left Middle'
    },
    'left-bottom': {
      bottom: marginVertical,
      left: marginHorizontal,
      horizontalAlign: 'flex-start',
      verticalAlign: 'flex-end',
      name: 'Left Bottom'
    },
    'center-top': {
      top: marginVertical,
      left: '50%',
      transform: [{ translateX: '-50%' }],
      horizontalAlign: 'center',
      verticalAlign: 'flex-start',
      name: 'Center Top'
    },
    'center-middle': {
      top: '50%',
      left: '50%',
      transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
      horizontalAlign: 'center',
      verticalAlign: 'center',
      name: 'Center Middle'
    },
    'center-bottom': {
      bottom: marginVertical,
      left: '50%',
      transform: [{ translateX: '-50%' }],
      horizontalAlign: 'center',
      verticalAlign: 'flex-end',
      name: 'Center Bottom'
    },
    'right-top': {
      top: marginVertical,
      right: marginHorizontal,
      horizontalAlign: 'flex-end',
      verticalAlign: 'flex-start',
      name: 'Right Top'
    },
    'right-middle': {
      top: '50%',
      right: marginHorizontal,
      transform: [{ translateY: '-50%' }],
      horizontalAlign: 'flex-end',
      verticalAlign: 'center',
      name: 'Right Middle'
    },
    'right-bottom': {
      bottom: marginVertical,
      right: marginHorizontal,
      horizontalAlign: 'flex-end',
      verticalAlign: 'flex-end',
      name: 'Right Bottom'
    }
  };
};
