document.addEventListener('DOMContentLoaded', () => {
    const productGrid = document.getElementById('productGrid');
    const searchInput = document.getElementById('productSearch');
    const sourceFilter = document.getElementById('sourceFilter');
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const heroSlides = document.querySelector('.hero-slides');
    let allProducts = [];

    // Slideshow images
    const slides = [
        'assets/images/slideshow/ebay-banner.jpg',
        'https://i.ebayimg.com/images/g/zFoAAOSwq9FoUfPJ/s-l1600.jpg',
        'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&q=80&w=1200',
        'https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&q=80&w=1200'
    ];

    let currentSlide = 0;

    function initSlideshow() {
        if (!heroSlides) return;
        
        heroSlides.innerHTML = slides.map((slide, index) => `
            <div class="hero-slide ${index === 0 ? 'active' : ''}" style="background-image: url('${slide}')"></div>
        `).join('');

        setInterval(() => {
            const slidesElements = document.querySelectorAll('.hero-slide');
            if (slidesElements.length > 0) {
                slidesElements[currentSlide].classList.remove('active');
                currentSlide = (currentSlide + 1) % slidesElements.length;
                slidesElements[currentSlide].classList.add('active');
            }
        }, 5000);
    }

    if (heroSlides) {
        initSlideshow();
    }

    // Theme logic
    const getPreferredTheme = () => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) return savedTheme;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const setTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        updateIcon(theme);
        updateTooltip(theme);
    };

    const updateIcon = (theme) => {
        if (theme === 'dark') {
            themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
        } else {
            themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
        }
    };

    const updateTooltip = (theme) => {
        themeToggle.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    };

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
    });

    // Initialize theme
    setTheme(getPreferredTheme());

    // Mobile hamburger menu
    const menuToggle = document.getElementById('menuToggle');
    const primaryNav = document.getElementById('primaryNav');
    if (menuToggle && primaryNav) {
        const setMenu = (open) => {
            primaryNav.classList.toggle('open', open);
            menuToggle.classList.toggle('open', open);
            menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        menuToggle.addEventListener('click', () => {
            setMenu(!primaryNav.classList.contains('open'));
        });
        // Close the menu after tapping a link.
        primaryNav.addEventListener('click', (event) => {
            if (event.target.closest('a')) setMenu(false);
        });
        // Reset when switching back to the desktop layout.
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) setMenu(false);
        });
    }

    // Fetch products from JSON
    if (productGrid && window.location.protocol === 'file:') {
        productGrid.innerHTML = `
            <div class="error" style="text-align: center; padding: 40px; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--primary);">
                <h3 style="color: var(--primary); margin-bottom: 10px;">Local Loading Restricted</h3>
                <p>Browsers block loading data from local files for security.</p>
                <p style="margin-top: 10px; font-size: 0.9rem;">To view products locally, please use a local web server like the <strong>Live Server</strong> extension in VS Code.</p>
                <p style="margin-top: 10px; font-size: 0.9rem;">The site will work perfectly once pushed to GitHub Pages.</p>
            </div>
        `;
    } else if (productGrid) {
        fetch('products.json')
            .then(response => response.json())
            .then(data => {
                // Sort products: eBay items first, then QuickBooks
                allProducts = data.sort((a, b) => {
                    if (a.source === b.source) return 0;
                    return a.source === 'eBay' ? -1 : 1;
                });
                displayProducts(allProducts);
            })
            .catch(error => {
                console.error('Error loading products:', error);
                productGrid.innerHTML = '<p class="error">Failed to load products. Please try again later.</p>';
            });
    }

    // Display products in the grid
    function displayProducts(products) {
        if (products.length === 0) {
            productGrid.innerHTML = '<p class="no-results">No products found.</p>';
            return;
        }

        productGrid.innerHTML = products.map(product => `
            <div class="product-card">
                <img src="${product.image}" alt="${product.title}" class="product-img">
                <div class="product-info">
                    <h3 class="product-title">${product.title}</h3>
                    <p class="product-price">$${product.price.toFixed(2)}</p>
                    <div class="product-meta">
                        <span>SKU: ${product.sku}</span><br>
                        <span>Source: ${product.source}</span>
                    </div>
                    <a href="${product.url}" class="btn" style="width: 100%; text-align: center;" target="_blank">View Details</a>
                </div>
            </div>
        `).join('');
    }

    // Filter and search functionality
    function filterProducts() {
        const searchTerm = searchInput.value.toLowerCase();
        const sourceValue = sourceFilter.value;

        const filteredProducts = allProducts.filter(product => {
            const matchesSearch = product.title.toLowerCase().includes(searchTerm) || 
                                 product.sku.toLowerCase().includes(searchTerm);
            const matchesSource = sourceValue === 'all' || product.source === sourceValue;
            return matchesSearch && matchesSource;
        });
        displayProducts(filteredProducts);
    }

    searchInput.addEventListener('input', filterProducts);
    sourceFilter.addEventListener('change', filterProducts);
});
