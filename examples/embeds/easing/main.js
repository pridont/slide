const balls = [
  { node: document.getElementById('one'), easing: 'linear' },
  { node: document.getElementById('two'), easing: 'cubic-bezier(0.2, 0, 0, 1)' },
]

function play() {
  for (const { node, easing } of balls) {
    const distance = node.parentElement.clientWidth - node.clientWidth - 6
    node.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${distance}px)` }], {
      duration: 1100,
      easing,
      fill: 'forwards',
    })
  }
}

document.getElementById('play').addEventListener('click', play)
play()
