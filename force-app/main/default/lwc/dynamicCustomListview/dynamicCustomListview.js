import { LightningElement, wire, track } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import getRecords from '@salesforce/apex/RecordDisplayController.getRecords';
import getConfig from '@salesforce/apex/RecordDisplayController.getConfig';

export default class RecordListView extends NavigationMixin(LightningElement) {
    @track records = [];
    @track filteredRecords = [];
    @track columns = [];
    @track error;
    @track isLoading = false;
    @track searchTerm = '';
    @track sortField = '';
    @track sortDirection = 'asc';
    @track totalRecords = 0;
    @track config = {};
    @track listTitle = 'Records';
    @track pageSize = 5;
    @track currentPage = 0;
    @track displayedRecords = [];
    @track hasMoreRecords = false;
    @track lastUpdateTime; // Track the last update timestamp

    expandedCardIds = new Set(); // Used for card expand/collapse

    configName = 'RecordToDisplay';

    wiredConfigResult;
    wiredRecordsResult;

    @wire(getConfig, { configName: '$configName' })
    wiredConfig(result) {
        this.wiredConfigResult = result;
        const { error, data } = result;

        if (data) {
            this.config = data;
            this.listTitle = this.config.recordType ?
                `${this.config.recordType} ${this.config.objectApiName}s` :
                `${this.config.objectApiName}s`;
            this.setupColumns();
            this.error = undefined;
        } else if (error) {
            this.error = error.body?.message || 'Error loading configuration';
            this.config = {};
            this.columns = [];
            this.listTitle = 'Records';
        }
    }

    @wire(getRecords, { configName: '$configName' })
    wiredRecords(result) {
        this.wiredRecordsResult = result;
        const { error, data } = result;

        this.isLoading = true;

        if (data) {
            try {
                this.records = data.map((record, index) => {
                    const mappedRecord = {
                        Id: record.Id,
                        key: `${record.Id}_${index}`,
                        rowNumber: index + 1,
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

                this.filteredRecords = [...this.records];
                this.totalRecords = this.records.length;
                this.applySorting();
                this.updateDisplayedRecords();
                this.lastUpdateTime = new Date(); // Set the last update time
                this.error = undefined;
            } catch (e) {
                this.error = 'Error processing records: ' + e.message;
                this.records = [];
                this.filteredRecords = [];
            }
        } else if (error) {
            this.error = error.body?.message || 'Error fetching records';
            this.records = [];
            this.filteredRecords = [];
        }

        this.isLoading = false;
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
                        type: 'text'
                    };
                } else if (typeof fieldConfig === 'object' && fieldConfig.fieldName) {
                    return {
                        label: fieldConfig.label || this.formatLabel(fieldConfig.fieldName),
                        fieldName: fieldConfig.fieldName,
                        sortable: fieldConfig.sortable !== false,
                        isLink: fieldConfig.isLink || false,
                        type: fieldConfig.type || 'text'
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

        record.visibleFields = (record.allFields || []).slice(0, 2);
        record.hiddenFields = (record.allFields || []).slice(2);

        const subtitleField = record.cells.find(cell =>
            cell.fieldName.toLowerCase().includes('id') ||
            cell.fieldName.toLowerCase().includes('number')
        );
        if (subtitleField) {
            record.subtitle = subtitleField.displayValue;
        }
    }

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

    handleSearch(event) {
    event.preventDefault();
    event.stopPropagation();

    const newSearchTerm = event.target.value.toLowerCase();

    // Only update if changed to avoid unnecessary re-renders
    if (this.searchTerm !== newSearchTerm) {
        this.searchTerm = newSearchTerm;
        this.filterRecords();
    }
}


    filterRecords() {
        if (!this.searchTerm) {
            this.filteredRecords = [...this.records];
        } else {
            this.filteredRecords = this.records.filter(record => {
                return record.cells.some(cell => {
                    return cell.value && cell.value.toLowerCase().includes(this.searchTerm);
                });
            });
        }
        this.totalRecords = this.filteredRecords.length;
        this.currentPage = 0;
        this.updateDisplayedRecords();
        this.lastUpdateTime = new Date(); // Update time on filter
    }

    handleSort(event) {
        const fieldName = event.currentTarget.dataset.field;
        if (this.sortField === fieldName) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = fieldName;
            this.sortDirection = 'asc';
        }
        this.sortRecords();
    }

    sortRecords() {
        if (!this.sortField) return;

        this.filteredRecords.sort((a, b) => {
            const aCell = a.cells.find(cell => cell.fieldName === this.sortField);
            const bCell = b.cells.find(cell => cell.fieldName === this.sortField);

            let aVal = aCell ? aCell.value : '';
            let bVal = bCell ? bCell.value : '';

            if (this.isNumericField(this.sortField)) {
                aVal = parseFloat(aVal) || 0;
                bVal = parseFloat(bVal) || 0;
            } else {
                aVal = aVal.toLowerCase();
                bVal = bVal.toLowerCase();
            }

            if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        this.currentPage = 0;
        this.updateDisplayedRecords();
        this.lastUpdateTime = new Date(); // Update time on sort
    }

    applySorting() {
        if (this.config.sortBy) {
            const sortParts = this.config.sortBy.split(' ');
            if (sortParts.length >= 2) {
                this.sortField = sortParts[0];
                this.sortDirection = sortParts[1].toLowerCase() === 'desc' ? 'desc' : 'asc';
                this.sortRecords();
            }
        }
    }

    isLinkField(fieldName) {
        return fieldName.toLowerCase().includes('name') ||
            fieldName.toLowerCase().includes('email') ||
            fieldName.toLowerCase().includes('url');
    }

    isNumericField(fieldName) {
        const column = this.columns.find(col => col.fieldName === fieldName);
        return column && ['currency', 'number', 'percent'].includes(column.type);
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

    handleRefresh() {
        this.isLoading = true;
        const refreshPromises = [];

        if (this.wiredConfigResult) refreshPromises.push(refreshApex(this.wiredConfigResult));
        if (this.wiredRecordsResult) refreshPromises.push(refreshApex(this.wiredRecordsResult));

        Promise.all(refreshPromises)
            .then(() => {
                this.showToast('Success', 'Records refreshed successfully', 'success');
                this.lastUpdateTime = new Date(); // Update time on refresh
            })
            .catch(error => {
                this.error = 'Error refreshing data: ' + (error.body?.message || error.message);
                this.showToast('Error', 'Failed to refresh records', 'error');
            })
            .finally(() => this.isLoading = false);
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

    get itemsDisplayText() {
        return `${this.totalRecords} items`;
    }

    get sortInfoText() {
        if (this.sortField) return `Sorted by ${this.formatLabel(this.sortField)}`;
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

    updateDisplayedRecords() {
        const startIndex = 0;
        const endIndex = (this.currentPage + 1) * this.pageSize;
        this.displayedRecords = this.filteredRecords.slice(startIndex, endIndex).map(record => ({
            ...record,
            isExpanded: this.expandedCardIds.has(record.Id)
        }));
        this.hasMoreRecords = this.filteredRecords.length > endIndex;
    }

    handleLoadMore() {
        this.currentPage++;
        this.updateDisplayedRecords();
    }

    handleCardExpand(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.id;
        if (this.expandedCardIds.has(recordId)) {
            this.expandedCardIds.delete(recordId);
        } else {
            this.expandedCardIds.add(recordId);
        }
        this.updateDisplayedRecords();
    }
}