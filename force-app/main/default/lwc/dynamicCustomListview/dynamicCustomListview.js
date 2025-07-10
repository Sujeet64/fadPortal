import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import getRecords from '@salesforce/apex/RecordDisplayController.getRecords';
import getConfig from '@salesforce/apex/RecordDisplayController.getConfig';

export default class RecordListView extends NavigationMixin(LightningElement) {
    @track records = [];
    @track columns = [];
    @track error;
    @track isLoading = false;
    @track searchTerm = '';
    @track sortField = '';
    @track sortDirection = 'asc';
    @track totalRecords = 0;
    @track config = {};
    @track listTitle = 'Records';
    @track displayedRecords = [];
    @track hasMoreRecords = false;
    @track lastUpdateTime;

    // Pagination properties
    pageSize = 10;
    currentOffset = 0;
    loadingType = 'loadMore'; // 'loadMore' or 'infiniteScroll'

    // Search debouncing
    searchTimeout;

    expandedCardIds = new Set();
    configName = 'RecordToDisplay';

    connectedCallback() {
        this.loadConfig();
    }

    renderedCallback() {
        // Fix search input focus issue
        const searchInput = this.template.querySelector('lightning-input');
        if (searchInput) {
            searchInput.focus();
            searchInput.blur();
        }

        // ADD: Attach scroll event listeners for infinite scroll
        if (this.loadingType === 'infiniteScroll') {
            this.attachScrollListeners();
        }
    }

    disconnectedCallback() {
        // Remove scroll event listeners
        this.removeScrollListeners();
    }

    // ADD: Method to attach scroll listeners to both desktop and mobile containers
    attachScrollListeners() {
        // Desktop table container
        const tableContainer = this.template.querySelector('.table-container');
        if (tableContainer) {
            tableContainer.addEventListener('scroll', this.handleScroll.bind(this));
        }

        // Mobile card container
        const mobileContainer = this.template.querySelector('.mobile-card-container');
        if (mobileContainer) {
            mobileContainer.addEventListener('scroll', this.handleScroll.bind(this));
        }
    }

    // ADD: Method to remove scroll listeners
    removeScrollListeners() {
        const tableContainer = this.template.querySelector('.table-container');
        if (tableContainer) {
            tableContainer.removeEventListener('scroll', this.handleScroll.bind(this));
        }

        const mobileContainer = this.template.querySelector('.mobile-card-container');
        if (mobileContainer) {
            mobileContainer.removeEventListener('scroll', this.handleScroll.bind(this));
        }
    }

    async loadConfig() {
        try {
            this.config = await getConfig({ configName: this.configName });
            this.listTitle = this.config.recordType ?
                `${this.config.recordType} ${this.config.objectApiName}s` :
                `${this.config.objectApiName}s`;
            this.pageSize = this.config.pageSize || 10;
            this.loadingType = this.config.loadingType || 'loadMore';
            this.setupColumns();
            this.loadRecords(true); // true = reset
        } catch (error) {
            this.error = error.body?.message || 'Error loading configuration';
            this.config = {};
            this.columns = [];
            this.listTitle = 'Records';
        }
    }

    async loadRecords(reset = false) {
        try {
            this.isLoading = true;
            this.error = undefined;

            if (reset) {
                this.currentOffset = 0;
                this.records = [];
                this.displayedRecords = [];
            }

            const sortBy = this.sortField ? `${this.sortField} ${this.sortDirection.toUpperCase()}` : this.config.sortBy;
            const result = await getRecords({
                configName: this.configName,
                pageSize: this.pageSize,
                offset: this.currentOffset,
                searchTerm: this.searchTerm,
                sortBy: sortBy
            });

            const mappedRecords = result.records.map((record, index) => {
                const mappedRecord = {
                    Id: record.Id,
                    key: `${record.Id}_${this.currentOffset + index}`,
                    rowNumber: this.currentOffset + index + 1,
                    cells: []
                };

                if (this.columns && this.columns.length > 0) {
                    this.columns.forEach(column => {
                        const fieldValue = this.getFieldValue(record, column.fieldName);
                        mappedRecord.cells.push({
                            fieldName: column.fieldName,
                            label: column.label,
                            value: fieldValue,
                            isLink: column.isLink,
                            displayValue: this.formatDisplayValue(fieldValue, column)
                        });
                    });
                }

                this.setupMobileFields(mappedRecord);
                return mappedRecord;
            });

            if (reset) {
                this.records = mappedRecords;
                this.displayedRecords = mappedRecords.map(record => ({
                    ...record,
                    isExpanded: this.expandedCardIds.has(record.Id)
                }));
            } else {
                this.records = [...this.records, ...mappedRecords];
                this.displayedRecords = [...this.displayedRecords, ...mappedRecords.map(record => ({
                    ...record,
                    isExpanded: this.expandedCardIds.has(record.Id)
                }))];
            }

            this.totalRecords = result.totalCount;
            this.hasMoreRecords = result.hasMore;
            this.currentOffset = result.currentOffset + result.records.length;
            this.lastUpdateTime = new Date();

        } catch (error) {
            this.error = error.body?.message || 'Error fetching records';
            this.records = [];
            this.displayedRecords = [];
        } finally {
            this.isLoading = false;
        }
    }

    setupColumns() {
        if (this.config.fields && this.config.fields.length > 0) {
            this.columns = this.config.fields.map(fieldConfig => {
                if (typeof fieldConfig === 'string') {
                    return {
                        label: this.formatLabel(fieldConfig),
                        fieldName: fieldConfig,
                        sortable: true,
                        isLink: this.isLinkField(fieldConfig),
                        type: 'text',
                        sortIcon: 'utility:arrowdown'
                    };
                } else if (typeof fieldConfig === 'object' && fieldConfig.fieldName) {
                    return {
                        label: fieldConfig.label || this.formatLabel(fieldConfig.fieldName),
                        fieldName: fieldConfig.fieldName,
                        sortable: fieldConfig.sortable !== false,
                        isLink: fieldConfig.isLink || false,
                        type: fieldConfig.type || 'text',
                        sortIcon: 'utility:arrowdown'
                    };
                }
            }).filter(col => col && col.fieldName);
        }
    }

    setupMobileFields(record) {
        if (!record.cells || record.cells.length === 0) return;

        const primaryFieldIndex = record.cells.findIndex(cell =>
            cell.fieldName.toLowerCase().includes('name') ||
            cell.fieldName.toLowerCase().includes('title') ||
            cell.fieldName.toLowerCase().includes('subject')
        );

        if (primaryFieldIndex >= 0) {
            record.primaryField = record.cells[primaryFieldIndex];
            record.allFields = record.cells.filter((cell, index) => index !== primaryFieldIndex);
        } else {
            record.primaryField = record.cells[0];
            record.allFields = record.cells.slice(1);
        }

        const visibleFieldsCount = this.config.visibleMobileFields || 2;
        record.visibleFields = (record.allFields || []).slice(0, visibleFieldsCount);
        record.hiddenFields = (record.allFields || []).slice(visibleFieldsCount);

        record.isExpandable = this.config.isExpandable || false;
        record.hasHiddenFields = record.hiddenFields.length > 0;
        record.showExpandButton = record.isExpandable && record.hasHiddenFields;

        const subtitleField = record.cells.find(cell =>
            cell.fieldName.toLowerCase().includes('id') ||
            cell.fieldName.toLowerCase().includes('number')
        );
        if (subtitleField) {
            record.subtitle = subtitleField.displayValue;
        }
    }

    handleSearch(event) {
        const newSearchTerm = event.target.value;
        
        // Clear existing timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        // Set new timeout for debounced search
        this.searchTimeout = setTimeout(() => {
            if (this.searchTerm !== newSearchTerm) {
                this.searchTerm = newSearchTerm;
                this.loadRecords(true); // Reset and load with new search
            }
        }, 500); // 500ms delay
    }

    handleSort(event) {
        const fieldName = event.currentTarget.dataset.field;
        if (this.sortField === fieldName) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = fieldName;
            this.sortDirection = 'asc';
        }
        
        this.columns = this.columns.map(col => ({
            ...col,
            sortIcon: col.fieldName === this.sortField 
                ? (this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown')
                : 'utility:arrowdown'
        }));
        this.loadRecords(true); // Reset and load with new sort
    }

    handleLoadMore() {
        if (this.hasMoreRecords && !this.isLoading) {
            this.loadRecords(false); // false = append to existing records
        }
    }

    handleRefresh() {
        this.expandedCardIds.clear();
        this.loadRecords(true);
        this.showToast('Success', 'Records refreshed successfully', 'success');
    }

    handleRowClick(event) {
        const recordId = event.currentTarget.dataset.id;
        this[NavigationMixin.Navigate]({
            type: 'standard__webPage',
            attributes: {
                url: `/frmportal/s/recorddetailpage?recordId=${recordId}`
            }
        });
    }

    handleCardExpand(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        
        if (!this.config.isExpandable) {
            return;
        }
        
        if (this.expandedCardIds.has(recordId)) {
            this.expandedCardIds.delete(recordId);
        } else {
            this.expandedCardIds.add(recordId);
        }
        
        // Update displayed records with new expansion state
        this.displayedRecords = this.displayedRecords.map(record => ({
            ...record,
            isExpanded: this.expandedCardIds.has(record.Id)
        }));
    }

    // UPDATED: Infinite scroll handling for both desktop and mobile
    handleScroll(event) {
        if (this.loadingType !== 'infiniteScroll') return;
        
        const target = event.target;
        const threshold = 100; // pixels from bottom
        const scrollTop = target.scrollTop;
        const scrollHeight = target.scrollHeight;
        const clientHeight = target.clientHeight;
        
        if (scrollTop + clientHeight >= scrollHeight - threshold) {
            if (this.hasMoreRecords && !this.isLoading) {
                this.loadRecords(false);
            }
        }
    }

    // Utility methods (keeping existing ones)
    getFieldValue(record, fieldName) {
        if (!record || !fieldName) return '';

        try {
            if (fieldName.includes('.')) {
                const parts = fieldName.split('.');
                let value = record;
                for (const part of parts) {
                    value = value?.[part];
                    if (value === null || value === undefined) break;
                }
                return value != null ? String(value) : '';
            }

            return record[fieldName] != null ? String(record[fieldName]) : '';
        } catch (error) {
            return '';
        }
    }

    formatDisplayValue(value, column) {
        if (!value) return '';

        try {
            switch (column.type) {
                case 'currency': return this.formatCurrency(value);
                case 'date': return this.formatDate(value);
                case 'datetime': return this.formatDateTime(value);
                case 'percent': return this.formatPercent(value);
                case 'phone': return this.formatPhone(value);
                default: return value;
            }
        } catch (error) {
            return value;
        }
    }

    formatLabel(fieldName) {
        if (!fieldName) return '';
        return fieldName
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    isLinkField(fieldName) {
        return fieldName.toLowerCase().includes('name') ||
            fieldName.toLowerCase().includes('email') ||
            fieldName.toLowerCase().includes('url');
    }

    showToast(title, message, variant) {
        const evt = new ShowToastEvent({ title, message, variant });
        this.dispatchEvent(evt);
    }

    formatCurrency(value) {
        try {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
        } catch (error) {
            return value;
        }
    }

    formatDate(value) {
        try {
            return new Date(value).toLocaleDateString();
        } catch (error) {
            return value;
        }
    }

    formatDateTime(value) {
        try {
            return new Date(value).toLocaleString();
        } catch (error) {
            return value;
        }
    }

    formatPercent(value) {
        try {
            return `${parseFloat(value).toFixed(2)}%`;
        } catch (error) {
            return value;
        }
    }

    formatPhone(value) {
        try {
            const cleaned = value.replace(/\D/g, '');
            if (cleaned.length === 10) {
                return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
            }
            return value;
        } catch (error) {
            return value;
        }
    }

    // Getters
    get itemsDisplayText() {
        return `${this.displayedRecords.length} of ${this.totalRecords} items`;
    }

    get sortInfoText() {
        if (this.sortField) return `Sorted by ${this.formatLabel(this.sortField)} ${this.sortDirection.toUpperCase()}`;
        return this.config.sortBy ? `Sorted by ${this.config.sortBy}` : 'Sorted by Name';
    }

    get filterInfoText() {
        let filterText = `Filtered by All ${this.config.objectApiName}s`;
        if (this.config.recordType) filterText += ` - ${this.config.recordType} Record Type`;
        return filterText;
    }

    get updateInfoText() {
        if (!this.lastUpdateTime) return 'Never updated';
        const now = new Date();
        const diffMs = now - this.lastUpdateTime;
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffSeconds / 60);
        const diffHours = Math.floor(diffMinutes / 60);

        if (diffSeconds < 60) {
            return `Updated ${diffSeconds} second${diffSeconds !== 1 ? 's' : ''} ago`;
        } else if (diffMinutes < 60) {
            return `Updated ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
        } else {
            return `Updated ${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        }
    }

    get showLoadMoreButton() {
        return this.loadingType === 'loadMore' && this.hasMoreRecords && !this.isLoading;
    }

    get showInfiniteScroll() {
        return this.loadingType === 'infiniteScroll';
    }

    // Computed property for filtered records (now using all loaded records)
    get filteredRecords() {
        return this.displayedRecords;
    }

    get getSortIcon() {
        return 'utility:arrowdown';
    }

    getSortIconForField(fieldName) {
        if (this.sortField === fieldName) {
            return this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown';
        }
        return 'utility:arrowdown';
    }
}