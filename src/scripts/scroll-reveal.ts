export function revealOnScroll() {
  const elements = document.querySelectorAll('.reveal')

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible')
        observer.unobserve(entry.target) // Stop observing once revealed
      }
    })
  }, {
    threshold: 0.2, // Give it breathing room so it doesn't flicker in and out
  })

  elements.forEach(el => observer.observe(el))
}
